import os
import json
import pandas as pd

def time_to_sec(t_str):
    try:
        parts = t_str.split(':')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        return 0

def build_data():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, 'data')
    web_dir = os.path.join(base_dir, 'web')
    web_data_dir = os.path.join(web_dir, 'data')
    os.makedirs(web_data_dir, exist_ok=True)

    print("Building CMRL Metro data...")
    cmrl_routes = pd.read_csv(os.path.join(data_dir, 'cmrl', 'routes.txt'))
    cmrl_stops = pd.read_csv(os.path.join(data_dir, 'cmrl', 'stops.txt'))
    cmrl_shapes = pd.read_csv(os.path.join(data_dir, 'cmrl', 'shapes.txt'))

    stations_dict = {}
    for _, s in cmrl_stops.iterrows():
        sid = str(s['stop_id']).strip()
        stations_dict[sid] = {
            'id': sid,
            'name': str(s['stop_name']).strip(),
            'lat': round(float(s['stop_lat']), 6),
            'lon': round(float(s['stop_lon']), 6),
            'lines': [],
            'is_interchange': False
        }

    blue_stations = [f"CMRL_{i:02d}" for i in range(1, 27)]
    green_stations = [f"CMRL_G{i:02d}" for i in range(1, 19)]
    
    inter_corridor_stations = [
        "CMRL_G01", "CMRL_G02", "CMRL_G03", "CMRL_G04", "CMRL_G05", 
        "CMRL_G06", "CMRL_G07", "CMRL_G08", "CMRL_G09", "CMRL_G10", 
        "CMRL_G11", "CMRL_G12", "CMRL_G13", "CMRL_G14", "CMRL_G15", 
        "CMRL_G16", "CMRL_G17", "CMRL_24", "CMRL_25", "CMRL_26"
    ]

    line_meta = {
        'CMRL_1': {
            'name': 'Blue Line',
            'color': '#0084ff',
            'badge': 'Blue',
            'corridor': 'Wimco Nagar Depot ↔ Chennai Airport',
            'station_ids': blue_stations,
            'shape_id': 'CMRL_1_0'
        },
        'CMRL_2': {
            'name': 'Green Line',
            'color': '#00d068',
            'badge': 'Green',
            'corridor': 'Puratchi Thalaivar Dr. MGR Central ↔ St. Thomas Mount',
            'station_ids': green_stations,
            'shape_id': 'CMRL_2_0'
        },
        'CMRL_3': {
            'name': 'Inter-Corridor',
            'color': '#a855f7',
            'badge': 'Inter-Corridor',
            'corridor': 'MGR Central ↔ Chennai Airport',
            'station_ids': inter_corridor_stations,
            'shape_id': None
        }
    }

    lines_output = {}
    for rid, meta in line_meta.items():
        st_seq = [sid for sid in meta['station_ids'] if sid in stations_dict]
        
        for sid in st_seq:
            if meta['name'] not in stations_dict[sid]['lines']:
                stations_dict[sid]['lines'].append(meta['name'])

        shape_pts = []
        if meta['shape_id']:
            sh = cmrl_shapes[cmrl_shapes['shape_id'] == meta['shape_id']].sort_values('shape_pt_sequence')
            shape_pts = [[round(float(r['shape_pt_lat']), 6), round(float(r['shape_pt_lon']), 6)] for _, r in sh.iterrows()]
        else:
            shape_pts = [[stations_dict[sid]['lat'], stations_dict[sid]['lon']] for sid in st_seq]

        lines_output[rid] = {
            'id': rid,
            'name': meta['name'],
            'color': meta['color'],
            'corridor': meta['corridor'],
            'station_ids': st_seq,
            'shape': shape_pts,
            'station_count': len(st_seq),
            'first_train': '05:00 AM',
            'last_train': '11:00 PM',
            'headway_peak': 'Every 6 mins',
            'headway_non_peak': 'Every 7-10 mins'
        }

    for sid, st in stations_dict.items():
        if len(st['lines']) > 1:
            st['is_interchange'] = True
    if 'CMRL_13' in stations_dict: stations_dict['CMRL_13']['is_interchange'] = True
    if 'CMRL_G01' in stations_dict: stations_dict['CMRL_G01']['is_interchange'] = True
    if 'CMRL_23' in stations_dict: stations_dict['CMRL_23']['is_interchange'] = True
    if 'CMRL_G17' in stations_dict: stations_dict['CMRL_G17']['is_interchange'] = True

    metro_data = {
        'lines': lines_output,
        'stations': stations_dict,
        'frequencies': {
            'peak': 'Every 6 minutes (05:00 - 08:00 & 17:00 - 20:00)',
            'non_peak': 'Every 7-10 minutes',
            'weekend': 'Every 7-14 minutes',
            'operating_hours': '05:00 AM - 11:00 PM'
        }
    }

    with open(os.path.join(web_data_dir, 'metro.json'), 'w', encoding='utf-8') as f:
        json.dump(metro_data, f, ensure_ascii=False, indent=2)
    print(f"Saved metro.json ({len(stations_dict)} stations, {len(lines_output)} lines)")

    # 2. MTC Bus Data
    print("Building MTC Bus data with exact departure timings and stop offsets...")
    mtc_stops = pd.read_csv(os.path.join(data_dir, 'mtc', 'stops.txt'))
    mtc_routes = pd.read_csv(os.path.join(data_dir, 'mtc', 'routes.txt'))
    mtc_trips = pd.read_csv(os.path.join(data_dir, 'mtc', 'trips.txt'), usecols=['trip_id', 'route_id', 'direction_id'])

    stops_dict = {}
    for _, s in mtc_stops.iterrows():
        sid = int(s['stop_id'])
        stops_dict[sid] = [
            str(s['stop_name']).strip(),
            round(float(s['stop_lat']), 5),
            round(float(s['stop_lon']), 5)
        ]

    rep_trips = mtc_trips.groupby(['route_id', 'direction_id'])['trip_id'].first().reset_index()
    rep_trip_set = set(rep_trips['trip_id'])
    trip_to_route = dict(zip(rep_trips['trip_id'], rep_trips['route_id']))
    all_trip_to_route = dict(zip(mtc_trips['trip_id'], mtc_trips['route_id']))

    # Load stop_times
    rep_st_chunks = []
    first_stops = []

    for chunk in pd.read_csv(os.path.join(data_dir, 'mtc', 'stop_times.txt'), 
                             usecols=['trip_id', 'stop_id', 'stop_sequence', 'departure_time'], 
                             chunksize=200000):
        # 1. Representative trips for route stop sequences
        m_rep = chunk[chunk['trip_id'].isin(rep_trip_set)]
        if len(m_rep): rep_st_chunks.append(m_rep)

        # 2. First stop (stop_sequence == 1) for all trips to get exact departure schedules
        m_first = chunk[chunk['stop_sequence'] == 1]
        if len(m_first): first_stops.append(m_first)

    rep_st = pd.concat(rep_st_chunks).sort_values(['trip_id', 'stop_sequence'])
    first_stops_df = pd.concat(first_stops)
    first_stops_df['route_id'] = first_stops_df['trip_id'].map(all_trip_to_route)

    # Build departure timetables per route
    route_departures = {}
    for rid, group in first_stops_df.groupby('route_id'):
        if pd.notna(rid):
            deps = sorted(list(set(group['departure_time'].astype(str).str[:5])))
            # Clean times (filter invalid)
            deps = [d for d in deps if len(d) == 5 and d[0].isdigit()]
            if deps:
                route_departures[int(rid)] = deps

    # Build stop sequences and travel minute offsets
    route_stops = {}
    route_offsets = {}
    stop_route_count = {}

    for trip_id, group in rep_st.groupby('trip_id'):
        r_id = int(trip_to_route[trip_id])
        st_list = []
        offset_list = []
        base_sec = time_to_sec(group['departure_time'].iloc[0])

        for _, row in group.iterrows():
            sid = int(row['stop_id'])
            if sid in stops_dict:
                st_list.append(sid)
                offset_min = round((time_to_sec(str(row['departure_time'])) - base_sec) / 60)
                offset_list.append(max(0, offset_min))

        if len(st_list) > 1:
            if r_id not in route_stops or len(st_list) > len(route_stops[r_id]):
                route_stops[r_id] = st_list
                route_offsets[r_id] = offset_list

    for r_id, st_list in route_stops.items():
        for sid in st_list:
            stop_route_count[sid] = stop_route_count.get(sid, 0) + 1

    routes_output = {}
    route_numbers_map = {}

    for _, r in mtc_routes.iterrows():
        rid = int(r['route_id'])
        if rid in route_stops:
            num = str(r['route_short_name']).strip()
            name = str(r['route_long_name']).strip()
            
            parts = [p.strip() for p in name.split(' TO ')]
            if len(parts) != 2:
                parts = [p.strip() for p in name.split(' to ')]
            origin = parts[0] if len(parts) == 2 else name
            dest = parts[1] if len(parts) == 2 else ''

            deps = route_departures.get(rid, [])

            routes_output[rid] = {
                'id': rid,
                'num': num,
                'name': name,
                'origin': origin,
                'dest': dest,
                'stops': route_stops[rid],
                'offsets': route_offsets.get(rid, [0] * len(route_stops[rid])),
                'count': len(route_stops[rid]),
                'departures': deps,
                'trips_count': len(deps),
                'first_bus': deps[0] if deps else '05:30',
                'last_bus': deps[-1] if deps else '22:00'
            }

            if num not in route_numbers_map:
                route_numbers_map[num] = []
            route_numbers_map[num].append(rid)

    sorted_stops = sorted(stop_route_count.items(), key=lambda x: x[1], reverse=True)
    major_hubs = []
    seen_hub_names = set()
    for sid, count in sorted_stops:
        if sid in stops_dict:
            name, lat, lon = stops_dict[sid]
            norm = name.lower().replace('bus stand', '').replace('bus terminus', '').replace('depot', '').strip()
            if norm not in seen_hub_names and len(major_hubs) < 16:
                seen_hub_names.add(norm)
                major_hubs.append({
                    'id': sid,
                    'name': name,
                    'lat': lat,
                    'lon': lon,
                    'routes_count': count
                })

    mtc_data = {
        'stops': stops_dict,
        'routes': routes_output,
        'major_hubs': major_hubs,
        'stats': {
            'total_routes': len(routes_output),
            'unique_bus_numbers': len(route_numbers_map),
            'total_stops': len(stops_dict),
            'metro_stations': len(stations_dict)
        }
    }

    out_path = os.path.join(web_data_dir, 'mtc_data.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(mtc_data, f, ensure_ascii=False)
    
    file_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Saved mtc_data.json with exact schedules ({len(routes_output)} routes, {file_size_mb:.2f} MB)")

if __name__ == '__main__':
    build_data()

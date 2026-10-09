import pandas as pd
import json

routes = pd.read_csv('data/mtc/routes.txt')
trips = pd.read_csv('data/mtc/trips.txt')
stops = pd.read_csv('data/mtc/stops.txt')

print(f"Total MTC routes: {len(routes)}")
print(f"Total trips: {len(trips)}")
print(f"Total stops: {len(stops)}")

# Find routes that actually have trips
routes_with_trips = routes[routes['route_id'].isin(trips['route_id'])].copy()
print(f"Routes with trips: {len(routes_with_trips)}")
print(f"Unique route_short_name with trips: {routes_with_trips['route_short_name'].nunique()}")

# Look at top popular bus route numbers
sample_names = ['29A', '570', '21G', '11G', '18D', '19B', '54', '23C']
for name in sample_names:
    matches = routes_with_trips[routes_with_trips['route_short_name'] == name]
    print(f"\nRoute {name} entries ({len(matches)}):")
    for _, r in matches.head(3).iterrows():
        print(f"  route_id={r['route_id']}: {r['route_long_name']}")

/**
 * Chennai Transit Explorer — Core Application Logic
 * Integrates CMRL Metro & MTC Bus GTFS data into an interactive Leaflet map.
 */

(function () {
  'use strict';

  // Application State
  const state = {
    metro: null,
    mtc: null,
    stopToRoutesMap: new Map(),
    activeRoute: null,
    activeRoutePolyline: null,
    activeRouteMarkers: [],
    metroLayers: {
      lines: [],
      markers: []
    },
    hubsLayer: null,
    activeTab: 'all',
    searchQuery: '',
    simulating: false,
    simTimer: null,
    simMarker: null,
    currentBasemap: 'dark',
    tileLayers: {},
    appliedDelay: 0,
    currentNextDepMin: null,
    cachedStopList: [],
    cachedOffsets: []
  };

  // Constants
  const CHENNAI_CENTER = [13.0827, 80.2707];
  const DEFAULT_ZOOM = 12;

  // DOM Elements
  const el = {
    map: document.getElementById('map'),
    searchInput: document.getElementById('search-input'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    filterTabs: document.querySelectorAll('.tab-btn'),
    quickChips: document.querySelectorAll('.chip-item'),
    resultsList: document.getElementById('results-list'),
    resultsCount: document.getElementById('results-count'),
    activeRouteCard: document.getElementById('active-route-card'),
    stationDetailCard: document.getElementById('station-detail-card'),
    searchResultsWrapper: document.getElementById('search-results-wrapper'),
    btnCloseRouteDetails: document.getElementById('btn-close-route-details'),
    btnCloseStationCard: document.getElementById('btn-close-station-card'),
    arcBadge: document.getElementById('arc-badge'),
    arcType: document.getElementById('arc-type'),
    arcName: document.getElementById('arc-name'),
    arcStatStops: document.getElementById('arc-stat-stops'),
    arcStatDistance: document.getElementById('arc-stat-distance'),
    arcStatMode: document.getElementById('arc-stat-mode'),
    stopTimeline: document.getElementById('stop-timeline'),
    timelineCounter: document.getElementById('timeline-counter'),
    btnZoomRoute: document.getElementById('btn-zoom-route'),
    btnReverseRoute: document.getElementById('btn-reverse-route'),
    btnSimulateVehicle: document.getElementById('btn-simulate-vehicle'),
    simBtnText: document.getElementById('sim-btn-text'),
    floatingBanner: document.getElementById('floating-route-banner'),
    frBadge: document.getElementById('fr-badge'),
    frTitle: document.getElementById('fr-title'),
    frSub: document.getElementById('fr-sub'),
    btnFrSimulate: document.getElementById('btn-fr-simulate'),
    btnFrClear: document.getElementById('btn-fr-clear'),
    btnRecenter: document.getElementById('btn-recenter'),
    btnToggleMetro: document.getElementById('btn-toggle-metro-layer'),
    btnToggleHubs: document.getElementById('btn-toggle-hubs-layer'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    sidebar: document.getElementById('sidebar'),
    btnLegendCollapse: document.getElementById('btn-legend-collapse'),
    legendBody: document.getElementById('legend-body'),
    baseBtns: document.querySelectorAll('.base-btn'),
    // Timing & Delay Elements
    depNextTime: document.getElementById('dep-next-time'),
    depCountdown: document.getElementById('dep-countdown'),
    btnToggleTimetable: document.getElementById('btn-toggle-timetable'),
    timetableDrawer: document.getElementById('timetable-drawer'),
    ttGrid: document.getElementById('tt-grid'),
    ttTotalCount: document.getElementById('tt-total-count'),
    udsTimes: document.getElementById('uds-times'),
    delayPills: document.querySelectorAll('.delay-pill'),
    dasVal: document.getElementById('das-val'),
    dsbText: document.getElementById('dsb-text'),
    delayStatusBadge: document.getElementById('delay-status-badge')
  };

  // 1. Initialize Map
  let map;

  function initMap() {
    map = L.map('map', {
      center: CHENNAI_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true
    });

    // Basemap tile definitions
    state.tileLayers.dark = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'dark-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    state.tileLayers.light = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    state.tileLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics'
    });

    state.tileLayers.dark.addTo(map);

    // Group for hubs
    state.hubsLayer = L.layerGroup().addTo(map);
  }

  // 2. Fetch Datasets
  async function loadData() {
    try {
      const [metroRes, mtcRes] = await Promise.all([
        fetch('data/metro.json'),
        fetch('data/mtc_data.json')
      ]);

      if (!metroRes.ok || !mtcRes.ok) {
        throw new Error('Failed to load GTFS web data files');
      }

      state.metro = await metroRes.json();
      state.mtc = await mtcRes.json();

      // Build Inverted Index: stop_id -> [route_id, ...]
      for (const [rId, route] of Object.entries(state.mtc.routes)) {
        for (const sId of route.stops) {
          if (!state.stopToRoutesMap.has(sId)) {
            state.stopToRoutesMap.set(sId, []);
          }
          state.stopToRoutesMap.get(sId).push(route);
        }
      }

      // Update Top Nav Metrics
      if (document.getElementById('metric-metro')) {
        document.getElementById('metric-metro').textContent = `${Object.keys(state.metro.stations).length} Stations`;
      }
      if (document.getElementById('metric-bus')) {
        document.getElementById('metric-bus').textContent = `${state.mtc.stats.unique_bus_numbers.toLocaleString()} Routes`;
      }
      if (document.getElementById('metric-stops')) {
        document.getElementById('metric-stops').textContent = `${state.mtc.stats.total_stops.toLocaleString()} Stops`;
      }

      // Render default layers
      renderMetroLines();
      renderMajorHubs();
      renderSearchResults();

    } catch (err) {
      console.error('Error loading transit data:', err);
      el.resultsList.innerHTML = `<div style="padding:20px; color:#ff4757;">Failed to load data. Please ensure the local server is running.</div>`;
    }
  }

  // 3. Render CMRL Metro
  function renderMetroLines() {
    if (!state.metro) return;

    // Clear previous
    state.metroLayers.lines.forEach(l => map.removeLayer(l));
    state.metroLayers.markers.forEach(m => map.removeLayer(m));
    state.metroLayers.lines = [];
    state.metroLayers.markers = [];

    // Draw Line Tracks
    Object.values(state.metro.lines).forEach(line => {
      if (!line.shape || line.shape.length === 0) return;

      const isInterCorridor = line.id === 'CMRL_3';

      // Outer glow line
      const glowPolyline = L.polyline(line.shape, {
        color: line.color,
        weight: isInterCorridor ? 6 : 9,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      // Main vibrant track line
      const mainPolyline = L.polyline(line.shape, {
        color: line.color,
        weight: isInterCorridor ? 3 : 5,
        opacity: 0.95,
        dashArray: isInterCorridor ? '8, 8' : null,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      mainPolyline.bindTooltip(`<strong>${line.name}</strong><br><span style="font-size:0.75rem">${line.corridor}</span>`, {
        sticky: true,
        className: 'metro-line-tooltip'
      });

      mainPolyline.on('click', () => {
        selectMetroLine(line);
      });

      state.metroLayers.lines.push(glowPolyline, mainPolyline);
    });

    // Draw Station Markers
    Object.values(state.metro.stations).forEach(station => {
      const isInterchange = station.is_interchange;
      const radius = isInterchange ? 7 : 5;
      const color = isInterchange ? '#fbbf24' : '#ffffff';

      const marker = L.circleMarker([station.lat, station.lon], {
        radius: radius,
        fillColor: color,
        color: '#070a11',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
      }).addTo(map);

      marker.bindTooltip(`
        <div style="font-family: Outfit, sans-serif; font-weight: 600;">
          ${station.name}
          ${isInterchange ? '<span style="color:#fbbf24; font-size:0.7rem;"> [Interchange]</span>' : ''}
        </div>
        <div style="font-size:0.75rem; color:#94a3b8;">${station.lines.join(' &bull; ')}</div>
      `, { direction: 'top', offset: [0, -6] });

      marker.on('click', () => {
        inspectStation(station);
      });

      state.metroLayers.markers.push(marker);
    });
  }

  // 4. Render Major Hubs Layer
  function renderMajorHubs() {
    if (!state.mtc || !state.mtc.major_hubs) return;
    state.hubsLayer.clearLayers();

    state.mtc.major_hubs.forEach(hub => {
      const hubIcon = L.divIcon({
        className: 'custom-hub-icon',
        html: `
          <div style="
            background: #0284c7;
            border: 2px solid #ffffff;
            color: #ffffff;
            font-size: 10px;
            font-weight: 800;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 10px rgba(2, 132, 199, 0.7);
            cursor: pointer;
          ">H</div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const marker = L.marker([hub.lat, hub.lon], { icon: hubIcon });
      marker.bindTooltip(`
        <div style="font-family: Outfit, sans-serif; font-weight: 700;">${hub.name}</div>
        <div style="color: #38bdf8; font-size: 0.75rem;">Major Hub &bull; ${hub.routes_count} Bus Routes</div>
      `);

      marker.on('click', () => {
        inspectHub(hub);
      });

      state.hubsLayer.addLayer(marker);
    });
  }

  // 5. Inspect Metro Station
  function inspectStation(station) {
    el.activeRouteCard.style.display = 'none';
    el.searchResultsWrapper.style.display = 'none';
    el.stationDetailCard.style.display = 'block';

    document.getElementById('sd-tag').textContent = station.is_interchange ? 'Metro Interchange' : 'Metro Station';
    document.getElementById('sd-tag').style.background = station.is_interchange ? '#fbbf24' : '#0084ff';
    document.getElementById('sd-title').textContent = station.name;
    document.getElementById('sd-coord').textContent = `${station.lat.toFixed(6)}, ${station.lon.toFixed(6)}`;
    document.getElementById('sd-frequency').style.display = 'block';

    const routesList = document.getElementById('sd-routes-list');
    routesList.innerHTML = '';

    // Metro Lines Serving Station
    station.lines.forEach(lineName => {
      const pill = document.createElement('button');
      pill.className = 'sd-route-pill';
      pill.style.borderColor = lineName.includes('Blue') ? '#0084ff' : '#00d068';
      pill.textContent = `🚇 ${lineName}`;
      pill.onclick = () => {
        const lineObj = Object.values(state.metro.lines).find(l => l.name === lineName);
        if (lineObj) selectMetroLine(lineObj);
      };
      routesList.appendChild(pill);
    });

    // Nearby MTC Buses (approx within 300m)
    let nearbyBuses = 0;
    for (const [stopId, stopData] of Object.entries(state.mtc.stops)) {
      const [sName, sLat, sLon] = stopData;
      const dist = getDistanceKm(station.lat, station.lon, sLat, sLon);
      if (dist < 0.35) {
        const routes = state.stopToRoutesMap.get(parseInt(stopId)) || [];
        routes.slice(0, 8).forEach(r => {
          if (nearbyBuses < 12) {
            nearbyBuses++;
            const pill = document.createElement('button');
            pill.className = 'sd-route-pill';
            pill.textContent = `🚌 ${r.num}`;
            pill.title = `${r.num}: ${r.name}`;
            pill.onclick = () => selectBusRoute(r);
            routesList.appendChild(pill);
          }
        });
      }
    }

    map.flyTo([station.lat, station.lon], 15, { duration: 1.2 });
  }

  // 6. Inspect Bus Hub
  function inspectHub(hub) {
    el.activeRouteCard.style.display = 'none';
    el.searchResultsWrapper.style.display = 'none';
    el.stationDetailCard.style.display = 'block';

    document.getElementById('sd-tag').textContent = 'MTC Bus Terminus Hub';
    document.getElementById('sd-tag').style.background = '#0284c7';
    document.getElementById('sd-title').textContent = hub.name;
    document.getElementById('sd-coord').textContent = `${hub.lat.toFixed(5)}, ${hub.lon.toFixed(5)}`;
    document.getElementById('sd-frequency').style.display = 'none';

    const routesList = document.getElementById('sd-routes-list');
    routesList.innerHTML = '';

    const routes = state.stopToRoutesMap.get(hub.id) || [];
    routes.slice(0, 30).forEach(r => {
      const pill = document.createElement('button');
      pill.className = 'sd-route-pill';
      pill.textContent = `🚌 ${r.num}`;
      pill.title = `${r.num}: ${r.name}`;
      pill.onclick = () => selectBusRoute(r);
      routesList.appendChild(pill);
    });

    map.flyTo([hub.lat, hub.lon], 14, { duration: 1.2 });
  }

  // 7. Select & Display Metro Line
  function selectMetroLine(line) {
    clearActiveRoute();
    stopSimulation();

    state.activeRoute = {
      type: 'metro',
      data: line
    };

    // Show floating banner
    el.floatingBanner.style.display = 'flex';
    el.frBadge.textContent = 'METRO';
    el.frBadge.style.background = line.color;
    el.frTitle.textContent = line.name;
    el.frSub.textContent = `${line.station_count} stations • ${line.corridor}`;

    // Switch Sidebar View
    el.stationDetailCard.style.display = 'none';
    el.searchResultsWrapper.style.display = 'none';
    el.activeRouteCard.style.display = 'block';

    el.arcBadge.textContent = line.name;
    el.arcBadge.style.background = line.color;
    el.arcType.textContent = 'CMRL Metro Line';
    el.arcName.textContent = line.corridor;
    el.arcStatStops.textContent = line.station_count;
    el.arcStatMode.textContent = 'Rapid Transit';

    // Calculate approximate line length
    const totalDist = calculatePathDistance(line.shape);
    el.arcStatDistance.textContent = `${totalDist.toFixed(1)} km`;

    // Update timing panel for Metro
    updateTimingAndSchedule({ type: 'metro', data: line });

    // Timeline of stations
    el.timelineCounter.textContent = `${line.station_count} stations`;
    el.stopTimeline.innerHTML = '';

    const currentMins = getCurrentChennaiMinutes();

    line.station_ids.forEach((sid, idx) => {
      const station = state.metro.stations[sid];
      if (!station) return;

      const item = document.createElement('div');
      item.className = 'timeline-item';
      if (idx === 0) item.classList.add('origin');
      if (idx === line.station_ids.length - 1) item.classList.add('dest');

      const stopEstMin = currentMins + (idx * 2) + state.appliedDelay;
      const timeStr = formatMinutesToTime(stopEstMin);

      item.innerHTML = `
        <div class="timeline-node" style="border-color: ${line.color}"></div>
        <div class="timeline-content">
          <span class="timeline-name">${station.name}</span>
          <span class="timeline-time ${state.appliedDelay > 0 ? 'delayed' : ''}">${timeStr}</span>
          <span class="timeline-seq">#${idx + 1}</span>
        </div>
      `;

      item.onclick = () => {
        map.flyTo([station.lat, station.lon], 16, { duration: 1 });
      };

      el.stopTimeline.appendChild(item);
    });

    // Fit map bounds
    if (line.shape && line.shape.length > 0) {
      map.fitBounds(line.shape, { padding: [60, 60], duration: 1 });
    }
  }

  // Helper Functions for Timings
  function parseTimeToMinutes(str) {
    if (!str || typeof str !== 'string') return 0;
    const parts = str.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  function formatMinutesToTime(mins) {
    const wrapped = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const displayM = m < 10 ? '0' + m : m;
    return `${displayH}:${displayM} ${ampm}`;
  }

  function getCurrentChennaiMinutes() {
    // Current time in Chennai timezone (UTC+5:30)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const chennaiDate = new Date(utc + (3600000 * 5.5));
    return chennaiDate.getHours() * 60 + chennaiDate.getMinutes();
  }

  function updateTimingAndSchedule(target) {
    if (target.type === 'metro') {
      el.depNextTime.textContent = 'Every 6m';
      el.depCountdown.textContent = 'Frequent';
      el.udsTimes.innerHTML = `
        <span class="uds-pill">Peak: 6m</span>
        <span class="uds-pill">Off-Peak: 8-10m</span>
        <span class="uds-pill">05:00 - 23:00</span>
      `;
      el.ttTotalCount.textContent = 'Frequency Service';
      el.ttGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 12px; font-size: 0.74rem; color: var(--text-muted); line-height: 1.5;">
          <strong>Metro Frequency Schedule:</strong><br>
          ⚡ <strong>Morning Peak (05:00 - 08:00):</strong> Every 6 minutes<br>
          ⏱️ <strong>Day Off-Peak (08:00 - 17:00):</strong> Every 7-10 minutes<br>
          ⚡ <strong>Evening Peak (17:00 - 20:00):</strong> Every 6 minutes<br>
          🌙 <strong>Night (20:00 - 23:00):</strong> Every 10-15 minutes
        </div>
      `;
      state.currentNextDepMin = getCurrentChennaiMinutes() + 3;
      return;
    }

    const route = target.data;
    const deps = route.departures || [];
    const currentMins = getCurrentChennaiMinutes();

    if (deps.length === 0) {
      el.depNextTime.textContent = 'Regular';
      el.depCountdown.textContent = 'Every 15-20m';
      el.udsTimes.innerHTML = `<span class="uds-pill">Frequent City Service</span>`;
      el.ttTotalCount.textContent = 'Regular trips';
      el.ttGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 10px; font-size: 0.75rem; color: #94a3b8;">Scheduled service operating throughout the day.</div>`;
      state.currentNextDepMin = currentMins + 8;
      return;
    }

    // Convert departures to minutes
    const depMins = deps.map(d => parseTimeToMinutes(d)).sort((a, b) => a - b);
    
    // Find next departure
    let nextDep = depMins.find(m => m >= currentMins);
    let isTomorrow = false;

    if (!nextDep) {
      // After last bus of the day, next is first bus tomorrow morning
      nextDep = depMins[0];
      isTomorrow = true;
    }

    state.currentNextDepMin = nextDep;

    // Next time display
    el.depNextTime.textContent = formatMinutesToTime(nextDep);

    // Countdown
    if (isTomorrow) {
      el.depCountdown.textContent = `Tomorrow at ${formatMinutesToTime(nextDep)}`;
    } else {
      const diff = nextDep - currentMins;
      if (diff <= 0) {
        el.depCountdown.textContent = 'Departing now';
      } else if (diff === 1) {
        el.depCountdown.textContent = 'In 1 min';
      } else if (diff < 60) {
        el.depCountdown.textContent = `In ${diff} mins`;
      } else {
        el.depCountdown.textContent = `In ${Math.floor(diff / 60)}h ${diff % 60}m`;
      }
    }

    // Upcoming departures
    const upcoming = depMins.filter(m => m > nextDep).slice(0, 4);
    el.udsTimes.innerHTML = '';
    if (upcoming.length > 0) {
      upcoming.forEach(m => {
        const pill = document.createElement('span');
        pill.className = 'uds-pill';
        pill.textContent = formatMinutesToTime(m);
        el.udsTimes.appendChild(pill);
      });
    } else {
      el.udsTimes.innerHTML = `<span class="uds-pill">Last trip of day: ${formatMinutesToTime(depMins[depMins.length - 1])}</span>`;
    }

    // Timetable Grid
    el.ttTotalCount.textContent = `${deps.length} scheduled trips`;
    el.ttGrid.innerHTML = '';
    depMins.forEach(m => {
      const slot = document.createElement('div');
      slot.className = 'tt-slot';
      if (m === nextDep) slot.classList.add('next');
      slot.textContent = formatMinutesToTime(m);
      el.ttGrid.appendChild(slot);
    });
  }

  // 8. Select & Display Bus Route
  function selectBusRoute(route) {
    clearActiveRoute();
    stopSimulation();

    state.activeRoute = {
      type: 'bus',
      data: route,
      reversed: false
    };

    // Extract ordered coordinates
    const stopCoords = [];
    const stopList = [];
    const offsets = route.offsets || [];

    route.stops.forEach((sid, idx) => {
      if (state.mtc.stops[sid]) {
        const [name, lat, lon] = state.mtc.stops[sid];
        stopCoords.push([lat, lon]);
        stopList.push({ 
          id: sid, 
          name, 
          lat, 
          lon,
          offset: offsets[idx] || (idx * 2)
        });
      }
    });

    if (stopCoords.length === 0) return;

    state.cachedStopList = stopList;
    state.cachedOffsets = offsets;

    // Draw Route Polyline with glow
    const glow = L.polyline(stopCoords, {
      color: '#ff4757',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    const line = L.polyline(stopCoords, {
      color: '#ff4757',
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    state.activeRoutePolyline = L.layerGroup([glow, line]).addTo(map);

    // Stop markers
    stopList.forEach((s, idx) => {
      const isOrigin = idx === 0;
      const isDest = idx === stopList.length - 1;

      let marker;
      if (isOrigin || isDest) {
        marker = L.circleMarker([s.lat, s.lon], {
          radius: 7,
          fillColor: isOrigin ? '#00d068' : '#ff4757',
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 1
        }).addTo(map);
      } else {
        marker = L.circleMarker([s.lat, s.lon], {
          radius: 4,
          fillColor: '#ffffff',
          color: '#070a11',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.9
        }).addTo(map);
      }

      marker.bindTooltip(`
        <strong>${s.name}</strong><br>
        <span style="font-size:0.75rem; color:#94a3b8;">Stop #${idx + 1} of ${stopList.length}</span>
      `);

      marker.on('click', () => {
        map.flyTo([s.lat, s.lon], 16, { duration: 0.8 });
      });

      state.activeRouteMarkers.push(marker);
    });

    // Floating Banner
    el.floatingBanner.style.display = 'flex';
    el.frBadge.textContent = route.num;
    el.frBadge.style.background = '#ff4757';
    el.frTitle.textContent = route.name;
    el.frSub.textContent = `${stopList.length} stops • ${route.trips_count || 'Daily'} trips scheduled`;

    // Sidebar Active Route View
    el.stationDetailCard.style.display = 'none';
    el.searchResultsWrapper.style.display = 'none';
    el.activeRouteCard.style.display = 'block';

    el.arcBadge.textContent = `MTC ${route.num}`;
    el.arcBadge.style.background = '#ff4757';
    el.arcType.textContent = 'MTC City Service';
    el.arcName.textContent = route.name;
    el.arcStatStops.textContent = stopList.length;
    el.arcStatMode.textContent = 'City Bus';

    const totalDist = calculatePathDistance(stopCoords);
    el.arcStatDistance.textContent = `${totalDist.toFixed(1)} km`;

    // Update Timetable and Schedule Panel
    updateTimingAndSchedule({ type: 'bus', data: route });

    // Timeline
    el.timelineCounter.textContent = `${stopList.length} stops`;
    renderStopTimeline(stopList, offsets);

    // Zoom map to fit route
    map.fitBounds(line.getBounds(), { padding: [60, 60], duration: 1.2 });
  }

  function renderStopTimeline(stopList, offsets) {
    el.stopTimeline.innerHTML = '';
    const baseDepMin = state.currentNextDepMin || getCurrentChennaiMinutes();

    stopList.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      if (idx === 0) item.classList.add('origin');
      if (idx === stopList.length - 1) item.classList.add('dest');

      const stopOffset = (offsets && offsets[idx] !== undefined) ? offsets[idx] : (s.offset || idx * 2);
      const stopArrivalMin = baseDepMin + stopOffset + state.appliedDelay;
      const arrivalTimeStr = formatMinutesToTime(stopArrivalMin);

      item.innerHTML = `
        <div class="timeline-node"></div>
        <div class="timeline-content">
          <span class="timeline-name">${s.name}</span>
          <span class="timeline-time ${state.appliedDelay > 0 ? 'delayed' : ''}">${arrivalTimeStr}</span>
          <span class="timeline-seq">#${idx + 1}</span>
        </div>
      `;

      item.onclick = () => {
        map.flyTo([s.lat, s.lon], 16, { duration: 1 });
      };

      el.stopTimeline.appendChild(item);
    });
  }

  // 9. Clear Active Route
  function clearActiveRoute() {
    if (state.activeRoutePolyline) {
      map.removeLayer(state.activeRoutePolyline);
      state.activeRoutePolyline = null;
    }
    state.activeRouteMarkers.forEach(m => map.removeLayer(m));
    state.activeRouteMarkers = [];
    state.activeRoute = null;

    stopSimulation();
    el.floatingBanner.style.display = 'none';
    el.activeRouteCard.style.display = 'none';
    el.searchResultsWrapper.style.display = 'block';
  }

  // 10. Search & Filter
  function renderSearchResults() {
    if (!state.metro || !state.mtc) return;

    const query = state.searchQuery.toLowerCase().trim();
    const tab = state.activeTab;
    const results = [];

    // Check Metro Lines
    if (tab === 'all' || tab === 'metro') {
      Object.values(state.metro.lines).forEach(line => {
        if (!query || line.name.toLowerCase().includes(query) || line.corridor.toLowerCase().includes(query)) {
          results.push({
            type: 'metro',
            id: line.id,
            badge: line.name,
            badgeClass: line.id === 'CMRL_1' ? 'badge-metro-blue' : line.id === 'CMRL_2' ? 'badge-metro-green' : 'badge-metro-purple',
            title: line.name,
            endpoints: line.corridor,
            meta: `${line.station_count} Stations`,
            raw: line
          });
        }
      });
    }

    // Check Major Hubs
    if (tab === 'all' || tab === 'hubs') {
      state.mtc.major_hubs.forEach(hub => {
        if (!query || hub.name.toLowerCase().includes(query)) {
          results.push({
            type: 'hub',
            id: hub.id,
            badge: 'HUB',
            badgeClass: 'badge-hub',
            title: hub.name,
            endpoints: `Major Terminus • Central Hub`,
            meta: `${hub.routes_count} Routes`,
            raw: hub
          });
        }
      });
    }

    // Check MTC Buses
    if (tab === 'all' || tab === 'bus') {
      let count = 0;
      const maxBuses = query ? 50 : 30; // Limit display for performance

      for (const route of Object.values(state.mtc.routes)) {
        if (count >= maxBuses) break;

        const matchNum = route.num.toLowerCase().includes(query);
        const matchName = route.name.toLowerCase().includes(query);

        if (!query || matchNum || matchName) {
          count++;
          results.push({
            type: 'bus',
            id: route.id,
            badge: route.num,
            badgeClass: 'badge-bus',
            title: route.name,
            endpoints: `${route.origin} ➔ ${route.dest || 'Terminus'}`,
            meta: `${route.count} Stops`,
            raw: route
          });
        }
      }
    }

    // Render cards
    el.resultsCount.textContent = `Showing ${results.length} transit options`;
    el.resultsList.innerHTML = '';

    if (results.length === 0) {
      el.resultsList.innerHTML = `
        <div style="text-align: center; padding: 30px 10px; color: var(--text-faint);">
          <p style="font-size: 1.1rem; margin-bottom: 6px;">🔍 No routes found</p>
          <p style="font-size: 0.8rem;">Try searching by route number (e.g. 29A, 570) or landmark (e.g. Central, Koyambedu).</p>
        </div>
      `;
      return;
    }

    results.forEach(res => {
      const card = document.createElement('div');
      card.className = 'route-card';

      card.innerHTML = `
        <div class="rc-top">
          <div class="rc-badge-group">
            <span class="rc-badge ${res.badgeClass}">${res.badge}</span>
            <span class="rc-meta">${res.meta}</span>
          </div>
          <span style="font-size:0.75rem; color:var(--text-faint);">${res.type.toUpperCase()}</span>
        </div>
        <div class="rc-title">${res.title}</div>
        <div class="rc-endpoints">
          <span>${res.endpoints}</span>
        </div>
      `;

      card.onclick = () => {
        if (res.type === 'metro') {
          selectMetroLine(res.raw);
        } else if (res.type === 'bus') {
          selectBusRoute(res.raw);
        } else if (res.type === 'hub') {
          inspectHub(res.raw);
        }
      };

      el.resultsList.appendChild(card);
    });
  }

  // 11. Vehicle Simulation Animation
  function startSimulation() {
    if (!state.activeRoute) return;
    stopSimulation();

    let coords = [];
    if (state.activeRoute.type === 'metro') {
      coords = state.activeRoute.data.shape;
    } else if (state.activeRoute.type === 'bus') {
      coords = state.activeRoute.data.stops.map(sid => {
        const s = state.mtc.stops[sid];
        return s ? [s[1], s[2]] : null;
      }).filter(Boolean);
    }

    if (!coords || coords.length < 2) return;

    state.simulating = true;
    el.simBtnText.textContent = 'Stop Sim';

    const simIcon = L.divIcon({
      className: 'vehicle-marker-sim',
      html: `<div class="vehicle-marker-pulse"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    state.simMarker = L.marker(coords[0], { icon: simIcon, zIndexOffset: 1000 }).addTo(map);

    let step = 0;
    const totalSteps = coords.length;

    state.simTimer = setInterval(() => {
      if (step >= totalSteps) {
        step = 0; // Loop simulation
      }
      const target = coords[step];
      state.simMarker.setLatLng(target);
      step++;
    }, 450);
  }

  function stopSimulation() {
    if (state.simTimer) {
      clearInterval(state.simTimer);
      state.simTimer = null;
    }
    if (state.simMarker) {
      map.removeLayer(state.simMarker);
      state.simMarker = null;
    }
    state.simulating = false;
    if (el.simBtnText) el.simBtnText.textContent = 'Simulate';
  }

  // 12. Helper Calculations
  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function calculatePathDistance(coords) {
    if (!coords || coords.length < 2) return 0;
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      dist += getDistanceKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    }
    return dist;
  }

  // 13. Event Listeners
  function setupEvents() {
    // Search input
    el.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      el.btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
      renderSearchResults();
    });

    el.btnClearSearch.addEventListener('click', () => {
      el.searchInput.value = '';
      state.searchQuery = '';
      el.btnClearSearch.style.display = 'none';
      renderSearchResults();
      el.searchInput.focus();
    });

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== el.searchInput) {
        e.preventDefault();
        el.searchInput.focus();
      }
      if (e.key === 'Escape') {
        if (el.searchInput.value) {
          el.searchInput.value = '';
          state.searchQuery = '';
          el.btnClearSearch.style.display = 'none';
          renderSearchResults();
        } else if (state.activeRoute) {
          clearActiveRoute();
        }
      }
    });

    // Tabs
    el.filterTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        el.filterTabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTab = btn.dataset.tab;
        renderSearchResults();
      });
    });

    // Quick Chips
    el.quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.dataset.query;
        el.searchInput.value = query;
        state.searchQuery = query;
        el.btnClearSearch.style.display = 'block';
        
        // Auto-switch tab if searching for Metro
        if (query.includes('Line')) {
          el.filterTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'metro'));
          state.activeTab = 'metro';
        } else {
          el.filterTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'all'));
          state.activeTab = 'all';
        }

        renderSearchResults();
      });
    });

    // Basemap switch
    el.baseBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        el.baseBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const style = btn.dataset.style;
        state.currentBasemap = style;

        Object.values(state.tileLayers).forEach(layer => map.removeLayer(layer));
        state.tileLayers[style].addTo(map);

        document.body.classList.toggle('light-theme', style === 'light');
      });
    });

    // Sidebar Close / Navigation Buttons
    el.btnCloseRouteDetails.addEventListener('click', clearActiveRoute);
    el.btnCloseStationCard.addEventListener('click', () => {
      el.stationDetailCard.style.display = 'none';
      el.searchResultsWrapper.style.display = 'block';
    });

    el.btnFrClear.addEventListener('click', clearActiveRoute);

    // Simulation Toggles
    el.btnSimulateVehicle.addEventListener('click', () => {
      if (state.simulating) stopSimulation();
      else startSimulation();
    });

    el.btnFrSimulate.addEventListener('click', () => {
      if (state.simulating) stopSimulation();
      else startSimulation();
    });

    // Recenter map
    el.btnRecenter.addEventListener('click', () => {
      map.flyTo(CHENNAI_CENTER, DEFAULT_ZOOM, { duration: 1.2 });
    });

    // Toggle Metro Layer
    let metroVisible = true;
    el.btnToggleMetro.addEventListener('click', () => {
      metroVisible = !metroVisible;
      state.metroLayers.lines.forEach(l => metroVisible ? map.addLayer(l) : map.removeLayer(l));
      state.metroLayers.markers.forEach(m => metroVisible ? map.addLayer(m) : map.removeLayer(m));
      el.btnToggleMetro.style.opacity = metroVisible ? '1' : '0.5';
    });

    // Toggle Hubs Layer
    let hubsVisible = true;
    el.btnToggleHubs.addEventListener('click', () => {
      hubsVisible = !hubsVisible;
      if (hubsVisible) map.addLayer(state.hubsLayer);
      else map.removeLayer(state.hubsLayer);
      el.btnToggleHubs.style.opacity = hubsVisible ? '1' : '0.5';
    });

    // Toggle Sidebar
    el.btnToggleSidebar.addEventListener('click', () => {
      el.sidebar.classList.toggle('collapsed');
      setTimeout(() => map.invalidateSize(), 300);
    });

    // Fit Route Zoom
    el.btnZoomRoute.addEventListener('click', () => {
      if (state.activeRoutePolyline) {
        const bounds = state.activeRoutePolyline.getLayers()[0].getBounds();
        map.fitBounds(bounds, { padding: [60, 60], duration: 1 });
      }
    });

    // Reverse Route Stops
    el.btnReverseRoute.addEventListener('click', () => {
      if (!state.activeRoute || state.activeRoute.type !== 'bus') return;
      state.activeRoute.reversed = !state.activeRoute.reversed;
      state.activeRoute.data.stops.reverse();
      selectBusRoute(state.activeRoute.data);
    });

    // Timetable Drawer Toggle
    if (el.btnToggleTimetable && el.timetableDrawer) {
      el.btnToggleTimetable.addEventListener('click', () => {
        const isHidden = el.timetableDrawer.style.display === 'none';
        el.timetableDrawer.style.display = isHidden ? 'block' : 'none';
        el.btnToggleTimetable.style.borderColor = isHidden ? 'var(--cmrl-blue)' : '';
      });
    }

    // Traffic Delay Simulation Pills
    if (el.delayPills) {
      el.delayPills.forEach(pill => {
        pill.addEventListener('click', () => {
          el.delayPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          state.appliedDelay = parseInt(pill.dataset.delay) || 0;

          if (state.appliedDelay === 0) {
            if (el.dasVal) el.dasVal.textContent = '+0 min (On-Time)';
            if (el.dsbText) el.dsbText.textContent = 'On-Time (Scheduled)';
            if (el.delayStatusBadge) el.delayStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
          } else {
            if (el.dasVal) el.dasVal.textContent = `+${state.appliedDelay} min delay`;
            if (el.dsbText) el.dsbText.textContent = `Late (+${state.appliedDelay}m)`;
            if (el.delayStatusBadge) el.delayStatusBadge.style.borderColor = '#fbbf24';
          }

          // Re-render stop sequence with the updated arrival times
          if (state.cachedStopList && state.cachedStopList.length > 0) {
            renderStopTimeline(state.cachedStopList, state.cachedOffsets);
          }
        });
      });
    }

    // Legend Collapse
    let legendCollapsed = false;
    el.btnLegendCollapse.addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      el.legendBody.style.display = legendCollapsed ? 'none' : 'flex';
      el.btnLegendCollapse.textContent = legendCollapsed ? '+' : '−';
    });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEvents();
    loadData();
  });

})();

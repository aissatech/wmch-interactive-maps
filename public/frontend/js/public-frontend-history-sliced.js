// Client rendering and functions for Public Map Frontend (History)
const isTimeline = true;

// jQuery map obj
const $map = $('#wmap');
// available layer colors
const colors = ['black', 'red', 'orange', 'green'];
// suffixes for dataset, so we can retrieve legend translations from map element dataset
const legendaSuffix = ['no', 'one', 'three', 'four'];
// legenda label for each layer (color)
const layersLabels = colors.map((color, idx) => {
  return {
    html: prettify($map.data(`filter-${legendaSuffix[idx]}`), color),
    color
  }
});

const updateLegenda = data => {
  const counts = colors.map(color => data.filter(feature => feature.properties.pin.color === color).length);
  $('.legenda-label').each((idx, el) => {
      // l'ordine di visualizzazione della legenda è il medesimo dell'ordine dei dati nell'array colors
      const components = $(el).text().split('(');
      const newText = `${components[0]} (${counts[idx].toString()})`;
      $(el).text(newText);
  });
}


L.Control.TimeDimensionCustom = L.Control.TimeDimension.extend({
  _getDisplayDateFormat: function(date) {
    const localeLang = typeof navigator.language !== 'undefined' ? navigator.language : "de-CH";
    return date.toLocaleDateString(localeLang) + " " + date.toLocaleTimeString(localeLang);
  }
});

L.TimeDimension.Layer.SuperClusterLayer = L.TimeDimension.Layer.extend({

  initialize: function(options) {
    // options
    this._baseURL   = options.baseURL || null;
    this._pinIcon   = options.pinIcon || null;
    this._noCluster = options.noCluster || null;

    if (options.mapId) {
      this._mapId = options.mapId;
    } else {
      console.warn('Map ID not provided to SuperClusterLayer. Data retrieving could fail');
    }

    this._clustersIndex = new Supercluster({
      radius: this._noCluster ? 0 : 90 // default value (to be updated when got data)
    });

    window.clustersIndex = this._clustersIndex;

    const clustersLayer = L.geoJSON(null, {
      onEachFeature : managePopup,
      pointToLayer  : (feature, latlng) => generateMarkerIcon(this._pinIcon, feature, latlng)
    });

    L.TimeDimension.Layer.prototype.initialize.call(this, clustersLayer, options);

    this._currentLoadedTime = 0;
    this._currentTimeData   = [];
    this._firstLoad         = true;
    this._mapReady          = false;
  },

  onAdd: function(map) {

    L.TimeDimension.Layer.prototype.onAdd.call(this, map);

    map.addLayer(this._baseLayer);

    // update clusters on map movements
    window.map.on('moveend', e => {
      updateClusters(this._baseLayer, this._clustersIndex)
    });

    if (this._timeDimension) {
      this._getDataForTime(this._timeDimension.getCurrentTime());
    }
  },

  _onNewTimeLoading: function(ev) {
    this._getDataForTime(ev.time);
    return;
  },

  isReady: function(time) {
    return (this._currentLoadedTime == time);
  },

  _update: function() {

    // perform clustering
    const staticData = this._currentTimeData.filter(el => !Boolean(el.postProcess));
    this._clustersIndex.load(staticData);

    updateClusters(this._baseLayer, this._clustersIndex);
    updateLegenda(staticData);

    // manage other pins
    this._updateDiffPinLayer(this._currentTimeData);

    this._mapReady = true;

    return true;
  },

  _updateDiffPinLayer: function(data) {
    const diffData = data.filter(el => Boolean(el.postProcess));
    const diffPinsLayer = L.geoJson(diffData, {
        onEachFeature : managePopup,
        pointToLayer  : (feature, latlng) => generateMarkerIcon(this._pinIcon, feature, latlng)
    });

    if (this._diffPinsLayer) {
      this._map.removeLayer(this._diffPinsLayer);
    }

    diffPinsLayer.addTo(this._map);
    this._diffPinsLayer = diffPinsLayer;
  },

  _getDataForTime: function(time) {
    if (!this._baseURL || !this._map || !this._mapId) {
      return;
    }

    const url = `${this._baseURL}?id=${this._mapId}&timestamp=${time}`;

    // get data
    $.getJSON(url, json => {

      if (this._firstLoad) {
        // update cluster radius
        const radius = this._noCluster ? 0 : json.length.mapVal(600, 15000, 10, 150);
        this._clustersIndex.options.radius = radius;
      }

      this._currentTimeData   = enrichFeatures(json);
      this._currentLoadedTime = time;

      if (this._timeDimension && time == this._timeDimension.getCurrentTime() && !this._timeDimension.isLoading()) {
        this._update();
      }

      this.fire('timeload', { time });

      if (this._firstLoad) {
        // hide the throbbler
        $('#pagepop').dimmer('hide');
        this._firstLoad = false;
      }

    }).fail(err => console.warn('Error getting data', url, err));
  },

  filterMapData: function(e) {
    if (this._mapReady && this._currentTimeData) {
      
      // prevent other user interactions
      const labels = document.querySelectorAll('.control-layers-labels');
      labels.forEach(lbl => lbl.classList.add('disabled'));

      // perform filtering
      const activeCheckboxes = Array.from(document.querySelectorAll('.leaflet-control-layers-selector:checked'));
      const activeColors = activeCheckboxes.map(input => input.dataset.color);
      const filteredData = filterByColors(this._currentTimeData, activeColors);

      // update pins
      this._updateDiffPinLayer(filteredData);

      // update clusters
      const newStaticData = filteredData.filter(el => !Boolean(el.postProcess));
      this._clustersIndex.load(newStaticData);

      // setTimeout(fn, 0) is a fix for updatig DOM status BEFORE starting clusters redraw
      // improves UX because it allows to set buttons as disabled
      // @link https://stackoverflow.com/questions/779379/why-is-settimeoutfn-0-sometimes-useful/4575011#4575011
      setTimeout(() => {
        // redraw clusters
        updateClusters(this._baseLayer, this._clustersIndex);
        // restore interaction
        labels.forEach(lbl => lbl.classList.remove('disabled'));
      }, 0);
    }
  }
});

L.timeDimension.layer.clusteredLayer = function(options) {
  return new L.TimeDimension.Layer.SuperClusterLayer(options);
};

/**************** ENTRY POINT **************/
$(function() {

  const t_entry = performance.now();

  const mobileDesktopLegenda = function() {
    if (isMobile()) {
      // mobile
      $('.leaflet-control-layers').removeClass('leaflet-control-layers-expanded');
    } else {
      // legenda sempre visibile su Desktop
      $('.leaflet-control-layers').addClass('leaflet-control-layers-expanded');
    }
  };

  $(window).resize(function() {
    mobileDesktopLegenda();
  });

  // display throbble while loading
  $('#pagepop').dimmer({ closable: false });
  $('#pagepop').dimmer('show');

  function loadLegenda(pinIcon, timedClustersLayer) {

    // options
    const controlOptions = {
      position     : 'topright',
      id           : 'filter-points-control',
      title        : 'Filter Layers',
      classes      : 'leaflet-control-layers', // use control-layers style
      labels       : layersLabels,
      filterAction : e => {
        timedClustersLayer.filterMapData(e);
      }
    };

    // add control
    L.control.customControl(controlOptions).addTo(window.map);

    // add icon to legenda
    $('.leaflet-control-layers-overlays .icon').each((index, el) => $(el).addClass(pinIcon));
  }

  // get options for current map
  $.ajax({
    type     : 'GET',
    url      : getVarUrl(),
    dataType : 'json',
    error    : err => console.warn('Error retrieving data from url parameters', err),
    success  : mapOpts => {

      mapOpts.baseAttribution = mapOpts.currentStyle.attribution + ' | ' + $('#author').html();
      mapOpts.subdomains = '1234';

      // retrieve available timestaps for current map
      $.get(`/api/timestamp?id=${mapOpts.id}`, timestamps => {

        // setup base map
        const basemap = new L.TileLayer(mapOpts.tile, {
          maxZoom     : mapOpts.maxZoom,
          minZoom     : mapOpts.minZoom,
          attribution : mapOpts.baseAttribution,
          subdomains  : mapOpts.subdomains,
          opacity     : 1.0
        });

        // load map in div #wmap
        window.map = new L.Map('wmap', {
          center               : new L.LatLng(mapOpts.startLat, mapOpts.startLng),
          fullscreenControl    : true,
          zoom                 : mapOpts.zoom,
          maxZoom              : mapOpts.maxZoom,
          minZoom              : mapOpts.minZoom,
          layers               : [basemap],
          timeDimensionControl : false, // add custom control later
          timeDimension        : true,
          timeDimensionOptions : {
            times : timestamps
          }
        });

        // add custom timeDimensionControl control
        const timeDimensionControl = new L.Control.TimeDimensionCustom({
          position      : 'bottomleft',
          autoPlay      : false,
          timeSlider    : true,
          speedSlider   : false,
          loopButton    : true,
          playerOptions : {
            transitionTime : 1000,
            loop           : true,
            buffer         : 1,
            minBufferReady : -1
          }
        });

        window.map.addControl(timeDimensionControl);

        // timed layer
        const timedClusters = L.timeDimension.layer.clusteredLayer({
          baseURL   : '/api/timedata',
          mapId     : mapOpts.id,
          pinIcon   : mapOpts.pinIcon,
          noCluster : mapOpts.noCluster
        });

        timedClusters.addTo(window.map);

        // load controls
        loadLegenda(mapOpts.pinIcon, timedClusters);
        fancyUI();

      }).fail(err => console.warn('Error retrieving data', err));
    }
  });
}); // END jQuery document Ready

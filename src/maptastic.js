var Maptastic = function(config) {

  var getProp = function(cfg, key, defaultVal){
    if(cfg && cfg.hasOwnProperty(key) && (cfg[key] !== null)) {
      return cfg[key];
    } else {
      return defaultVal;
    }
  }

  var showLayerNames       = getProp(config, 'labels', true);
  var showCrosshairs       = getProp(config, 'crosshairs', false);
  var showScreenBounds     = getProp(config, 'screenbounds', false);
  var autoSave             = getProp(config, 'autoSave', true);
  var autoLoad             = getProp(config, 'autoLoad', true);
  var layerList            = getProp(config, 'layers', []);
  var layoutChangeListener = getProp(config, 'onchange', function(){} );
  var localStorageKey      = 'maptastic.layers';

  var canvas = null;
  var context = null;

  var ioButton = null;
  var ioPanel = null;
  var ioFileInput = null;
  var ioUrlInput = null;
  var ioHelpPopup = null;
  var ioSlicePopup = null;
  var ioSchedulePopup = null;
  var ioScheduleTableBody = null;
  var ioSlicePreview = null;
  var ioSliceBox = null;
  var ioSliceDraftRect = null;
  var ioSliceDragStart = null;
  var ioSliceDragMode = '';
  var ioSliceDragRectStart = null;
  var ioSlicePreviewMap = null;
  var ioSliceHandleRadius = 10;
  var ioSliceCornerHandles = null;
  var ioSliceSelectedHandle = '';
  var ioEdgeBlendControls = null;
  var ioSubdivisionControls = null;
  var scheduleTickTimer = null;
  var scheduleLastTriggerMap = {};
  var scheduleActiveDay = '';
  var uiControlDragActive = false;
  var triangleWarpRaf = null;
  var runtimeScriptTextCache = '';

  var layers = [];

  var configActive = false;

  var dragging = false;
  var dragOffset = [];

  var selectedLayer = null;
  var selectedPoint = null;
  var selectedMeshPoints = [];
  var selectionRadius = 20;
  var hoveringPoint = null;
  var hoveringLayer = null;
  var dragOperation = "move";
  var isLayerSoloed = false;
  var dynamicLayerCounter = 1;

  var mousePosition = [];
  var mouseDelta = [];
  var mouseDownPoint = [];

  var isToggleEditShortcut = function(event) {
    var isSpace = (event.code === 'Space' || event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.keyCode === 32);
    return !!(event.shiftKey && isSpace);
  };

  var globalShortcutHandler = function(event) {
    if(!isToggleEditShortcut(event)) {
      return;
    }
    if(event.repeat) {
      event.preventDefault();
      return;
    }
    if(event.__maptasticToggleHandled) {
      return;
    }
    event.__maptasticToggleHandled = true;
    event.preventDefault();
    event.stopPropagation();
    setConfigEnabled(!configActive);
  };


	// Compute linear distance.
	var distanceTo = function(x1, y1, x2, y2) {
	  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
	}

  var pointInTriangle = function(point, a, b, c) {
		var s = a[1] * c[0] - a[0] * c[1] + (c[1] - a[1]) * point[0] + (a[0] - c[0]) * point[1];
		var t = a[0] * b[1] - a[1] * b[0] + (a[1] - b[1]) * point[0] + (b[0] - a[0]) * point[1];

		if ((s < 0) != (t < 0)) {
		return false;
		}

		var A = -b[1] * c[0] + a[1] * (c[0] - b[0]) + a[0] * (b[1] - c[1]) + b[0] * c[1];
		if (A < 0.0) {
		s = -s;
		t = -t;
		A = -A;
		}

		return s > 0 && t > 0 && (s + t) < A;
	};

	// determine if a point is inside a layer quad.
	var pointInLayer = function(point, layer) {
	  var a = pointInTriangle(point, layer.targetPoints[0], layer.targetPoints[1], layer.targetPoints[2]);
	  var b = pointInTriangle(point, layer.targetPoints[3], layer.targetPoints[0], layer.targetPoints[2]);
	  return a || b;
	};

  var isFormControlTarget = function(target) {
    if(!target || !target.tagName) {
      return false;
    }
    var tag = String(target.tagName).toUpperCase();
    if(tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'LABEL') {
      return true;
    }
    if(target.closest && target.closest('input,select,textarea,button,label')) {
      return true;
    }
    return false;
  };
  var isKeyboardTextEntryTarget = function(target) {
    if(!target) {
      return false;
    }
    if(target.isContentEditable) {
      return true;
    }
    if(!target.tagName) {
      return false;
    }
    var tag = String(target.tagName).toUpperCase();
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
    if(target.closest && target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) {
      return true;
    }
    return false;
  };
  var notifyChangeListener = function() {
    layoutChangeListener();
  };

  var hasPointReference = function(list, point) {
    if(!list || !point) {
      return false;
    }
    for(var i = 0; i < list.length; i++) {
      if(list[i] === point) {
        return true;
      }
    }
    return false;
  };

  var findNearestPoint = function(points, x, y, radius) {
    if(!points || points.length === 0) {
      return null;
    }
    var best = null;
    var bestDist = radius;
    for(var i = 0; i < points.length; i++) {
      var point = points[i];
      var d = distanceTo(point[0], point[1], x, y);
      if(d < bestDist) {
        best = point;
        bestDist = d;
      }
    }
    return best;
  };
  var isPointInMesh = function(layer, point) {
    return !!(layer && layer.mesh && layer.mesh.points && hasPointReference(layer.mesh.points, point));
  };

  var isPointInTargetCorners = function(layer, point) {
    return !!(layer && layer.targetPoints && hasPointReference(layer.targetPoints, point));
  };

  var clearMeshSelection = function() {
    selectedMeshPoints = [];
  };

  var normalizeMeshSelection = function(layer) {
    if(!layer || !layer.mesh || !layer.mesh.points) {
      selectedMeshPoints = [];
      return;
    }
    var keep = [];
    for(var i = 0; i < selectedMeshPoints.length; i++) {
      if(hasPointReference(layer.mesh.points, selectedMeshPoints[i])) {
        keep.push(selectedMeshPoints[i]);
      }
    }
    selectedMeshPoints = keep;
  };

  var selectMeshPoint = function(layer, point, addMode) {
    if(!layer || !point || !isPointInMesh(layer, point)) {
      return;
    }

    normalizeMeshSelection(layer);

    if(addMode) {
      if(hasPointReference(selectedMeshPoints, point)) {
        var next = [];
        for(var i = 0; i < selectedMeshPoints.length; i++) {
          if(selectedMeshPoints[i] !== point) {
            next.push(selectedMeshPoints[i]);
          }
        }
        selectedMeshPoints = next;
      } else {
        selectedMeshPoints.push(point);
      }
    } else {
      selectedMeshPoints = [point];
    }

    selectedPoint = selectedMeshPoints.length > 0 ? selectedMeshPoints[selectedMeshPoints.length - 1] : null;
  };
  var meshPointIndex = function(columns, row, col) {
    return (row * (columns + 1)) + col;
  };

  var bilinearPoint = function(points, u, v) {
    var tl = points[0];
    var tr = points[1];
    var br = points[2];
    var bl = points[3];
    return [
      ((1 - u) * (1 - v) * tl[0]) + (u * (1 - v) * tr[0]) + (u * v * br[0]) + ((1 - u) * v * bl[0]),
      ((1 - u) * (1 - v) * tl[1]) + (u * (1 - v) * tr[1]) + (u * v * br[1]) + ((1 - u) * v * bl[1])
    ];
  };

  var rebuildLayerMeshFromTarget = function(layer, columns, rows) {
    if(!layer) {
      return;
    }
    var cols = Math.max(1, Number(columns || (layer.mesh && layer.mesh.columns) || 1));
    var rws = Math.max(1, Number(rows || (layer.mesh && layer.mesh.rows) || 1));
    var pts = [];
    for(var y = 0; y <= rws; y++) {
      var v = y / rws;
      for(var x = 0; x <= cols; x++) {
        var u = x / cols;
        pts.push(bilinearPoint(layer.targetPoints, u, v));
      }
    }
    layer.mesh = {
      columns: cols,
      rows: rws,
      points: pts
    };
  };

  var ensureLayerMesh = function(layer) {
    if(!layer) {
      return;
    }
    if(!layer.mesh || typeof layer.mesh !== 'object') {
      rebuildLayerMeshFromTarget(layer, 1, 1);
      return;
    }
    var cols = Math.max(1, Number(layer.mesh.columns || 1));
    var rows = Math.max(1, Number(layer.mesh.rows || 1));
    var expected = (cols + 1) * (rows + 1);
    if(!layer.mesh.points || layer.mesh.points.length !== expected) {
      rebuildLayerMeshFromTarget(layer, cols, rows);
      return;
    }
    layer.mesh.columns = cols;
    layer.mesh.rows = rows;
  };

  var getLayerSourceRect = function(layer) {
    var rect = (layer && layer.slice && layer.slice.sourceRect) ? layer.slice.sourceRect : null;
    if(!rect) {
      return { x: 0, y: 0, width: layer.width, height: layer.height };
    }
    return {
      x: Number(rect.x || 0),
      y: Number(rect.y || 0),
      width: Math.max(1, Number(rect.width || layer.width)),
      height: Math.max(1, Number(rect.height || layer.height))
    };
  };

  var getLayerMeshSourcePoints = function(layer) {
    ensureLayerMesh(layer);
    if(!layer || !layer.mesh) {
      return [];
    }
    var cols = Math.max(1, Number(layer.mesh.columns || 1));
    var rows = Math.max(1, Number(layer.mesh.rows || 1));
    var srcRect = getLayerSourceRect(layer);
    var points = [];
    for(var y = 0; y <= rows; y++) {
      var v = y / rows;
      for(var x = 0; x <= cols; x++) {
        var u = x / cols;
        points.push([
          srcRect.x + (u * srcRect.width),
          srcRect.y + (v * srcRect.height)
        ]);
      }
    }
    return points;
  };

    var solveHomographyLeastSquares = function(sourcePts, targetPts) {
    if(!sourcePts || !targetPts || sourcePts.length !== targetPts.length || sourcePts.length < 4) {
      return null;
    }

    var normalizeSet = function(points) {
      var mx = 0;
      var my = 0;
      for(var i = 0; i < points.length; i++) {
        mx += points[i][0];
        my += points[i][1];
      }
      mx /= points.length;
      my /= points.length;

      var avgDist = 0;
      for(var d = 0; d < points.length; d++) {
        var dx = points[d][0] - mx;
        var dy = points[d][1] - my;
        avgDist += Math.sqrt((dx * dx) + (dy * dy));
      }
      avgDist = avgDist / points.length;
      var s = (avgDist > 1e-6) ? (Math.SQRT2 / avgDist) : 1;

      var norm = [];
      for(var n = 0; n < points.length; n++) {
        norm.push([
          (points[n][0] - mx) * s,
          (points[n][1] - my) * s
        ]);
      }

      return {
        points: norm,
        T: [
          [s, 0, -s * mx],
          [0, s, -s * my],
          [0, 0, 1]
        ],
        invT: [
          [1 / s, 0, mx],
          [0, 1 / s, my],
          [0, 0, 1]
        ]
      };
    };

    var mul3 = function(a, b) {
      var out = [[0,0,0],[0,0,0],[0,0,0]];
      for(var r = 0; r < 3; r++) {
        for(var c = 0; c < 3; c++) {
          out[r][c] = (a[r][0] * b[0][c]) + (a[r][1] * b[1][c]) + (a[r][2] * b[2][c]);
        }
      }
      return out;
    };

    var srcN = normalizeSet(sourcePts);
    var dstN = normalizeSet(targetPts);

    var ata = [];
    var atb = [];
    for(var k = 0; k < 8; k++) {
      ata.push([0,0,0,0,0,0,0,0]);
      atb.push(0);
    }

    var accumulate = function(row, value) {
      for(var i = 0; i < 8; i++) {
        atb[i] += row[i] * value;
        for(var j = 0; j < 8; j++) {
          ata[i][j] += row[i] * row[j];
        }
      }
    };

    for(var p = 0; p < srcN.points.length; p++) {
      var s = srcN.points[p];
      var t = dstN.points[p];
      var rowX = [s[0], s[1], 1, 0, 0, 0, -s[0] * t[0], -s[1] * t[0]];
      var rowY = [0, 0, 0, s[0], s[1], 1, -s[0] * t[1], -s[1] * t[1]];
      accumulate(rowX, t[0]);
      accumulate(rowY, t[1]);
    }

    var lambda = 1e-8;
    for(var diag = 0; diag < 8; diag++) {
      ata[diag][diag] += lambda;
    }

    var solved = null;
    try {
      solved = solve(ata, atb, true);
    } catch(e) {
      solved = null;
    }
    if(!solved || solved.length < 8) {
      return null;
    }

    var Hn = [
      [solved[0], solved[1], solved[2]],
      [solved[3], solved[4], solved[5]],
      [solved[6], solved[7], 1]
    ];

    var H = mul3(dstN.invT, mul3(Hn, srcN.T));
    var h33 = H[2][2];
    if(!isFinite(h33) || Math.abs(h33) < 1e-8) {
      return null;
    }

    for(var rr = 0; rr < 3; rr++) {
      for(var cc = 0; cc < 3; cc++) {
        H[rr][cc] = H[rr][cc] / h33;
        if(!isFinite(H[rr][cc])) {
          return null;
        }
      }
    }

    return [
      H[0][0], H[1][0], 0, H[2][0],
      H[0][1], H[1][1], 0, H[2][1],
      0, 0, 1, 0,
      H[0][2], H[1][2], 0, H[2][2]
    ];
  };
  var getLayerMeshCornerTargets = function(layer) {
    if(!layer || !layer.mesh || !layer.mesh.points) {
      return null;
    }
    ensureLayerMesh(layer);
    var cols = Math.max(1, Number(layer.mesh.columns || 1));
    var rows = Math.max(1, Number(layer.mesh.rows || 1));
    var pts = layer.mesh.points;
    var tl = pts[meshPointIndex(cols, 0, 0)];
    var tr = pts[meshPointIndex(cols, 0, cols)];
    var br = pts[meshPointIndex(cols, rows, cols)];
    var bl = pts[meshPointIndex(cols, rows, 0)];
    if(!tl || !tr || !br || !bl) {
      return null;
    }
    return [tl, tr, br, bl];
  };
  var isDrawableLayerElement = function(layer) {
    if(!layer || !layer.element || !layer.element.tagName) {
      return false;
    }
    var tag = String(layer.element.tagName).toUpperCase();
    return (tag === 'VIDEO' || tag === 'IMG' || tag === 'CANVAS');
  };

  var shouldUseTriangleWarp = function(layer) {
    if(!layer || !layer.mesh) {
      return false;
    }
    if(!isDrawableLayerElement(layer)) {
      return false;
    }
    return ((layer.mesh.columns > 1) || (layer.mesh.rows > 1));
  };

  var ensureLayerTriangleCanvas = function(layer) {
    if(!layer) {
      return null;
    }
    if(layer.triangleCanvas && layer.triangleCanvas.parentNode) {
      return layer.triangleCanvas;
    }

    var tc = document.createElement('canvas');
    tc.style.position = 'fixed';
    tc.style.left = '0px';
    tc.style.top = '0px';
    tc.style.pointerEvents = 'none';
    tc.style.margin = '0px';
    tc.style.padding = '0px';
    tc.style.display = 'none';
    document.body.appendChild(tc);

    layer.triangleCanvas = tc;
    layer.triangleContext = tc.getContext('2d');
    return tc;
  };

  var removeLayerTriangleCanvas = function(layer) {
    if(!layer || !layer.triangleCanvas) {
      return;
    }
    if(layer.triangleCanvas.parentNode) {
      layer.triangleCanvas.parentNode.removeChild(layer.triangleCanvas);
    }
    layer.triangleCanvas = null;
    layer.triangleContext = null;
    layer.triangleWarpActive = false;
  };

  var resizeLayerTriangleCanvas = function(layer) {
    if(!layer || !layer.triangleCanvas) {
      return;
    }
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    if(layer.triangleCanvas.width !== w || layer.triangleCanvas.height !== h) {
      layer.triangleCanvas.width = w;
      layer.triangleCanvas.height = h;
      layer.triangleCanvas.style.width = w + 'px';
      layer.triangleCanvas.style.height = h + 'px';
    }
  };

  var getLayerMediaDrawSize = function(layer) {
    if(!layer || !layer.element) {
      return null;
    }
    var el = layer.element;
    var tag = String(el.tagName || '').toUpperCase();
    if(tag === 'VIDEO') {
      return {
        width: Math.max(1, Number(el.videoWidth || layer.width || 1)),
        height: Math.max(1, Number(el.videoHeight || layer.height || 1))
      };
    }
    if(tag === 'IMG') {
      return {
        width: Math.max(1, Number(el.naturalWidth || layer.width || 1)),
        height: Math.max(1, Number(el.naturalHeight || layer.height || 1))
      };
    }
    if(tag === 'CANVAS') {
      return {
        width: Math.max(1, Number(el.width || layer.width || 1)),
        height: Math.max(1, Number(el.height || layer.height || 1))
      };
    }
    return null;
  };

  var solveAffineFromTriangles = function(s0, s1, s2, d0, d1, d2) {
    var x0 = s0[0], y0 = s0[1];
    var x1 = s1[0], y1 = s1[1];
    var x2 = s2[0], y2 = s2[1];

    var X0 = d0[0], Y0 = d0[1];
    var X1 = d1[0], Y1 = d1[1];
    var X2 = d2[0], Y2 = d2[1];

    var den = (x0 * (y1 - y2)) + (x1 * (y2 - y0)) + (x2 * (y0 - y1));
    if(Math.abs(den) < 1e-8) {
      return null;
    }

    var a = ((X0 * (y1 - y2)) + (X1 * (y2 - y0)) + (X2 * (y0 - y1))) / den;
    var c = ((X0 * (x2 - x1)) + (X1 * (x0 - x2)) + (X2 * (x1 - x0))) / den;
    var e = ((X0 * ((x1 * y2) - (x2 * y1))) + (X1 * ((x2 * y0) - (x0 * y2))) + (X2 * ((x0 * y1) - (x1 * y0)))) / den;

    var b = ((Y0 * (y1 - y2)) + (Y1 * (y2 - y0)) + (Y2 * (y0 - y1))) / den;
    var d = ((Y0 * (x2 - x1)) + (Y1 * (x0 - x2)) + (Y2 * (x1 - x0))) / den;
    var f = ((Y0 * ((x1 * y2) - (x2 * y1))) + (Y1 * ((x2 * y0) - (x0 * y2))) + (Y2 * ((x0 * y1) - (x1 * y0)))) / den;

    if(!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d) || !isFinite(e) || !isFinite(f)) {
      return null;
    }

    return [a, b, c, d, e, f];
  };

  var drawTexturedTriangle = function(ctx, media, s0, s1, s2, d0, d1, d2) {
    var aff = solveAffineFromTriangles(s0, s1, s2, d0, d1, d2);
    if(!aff) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0[0], d0[1]);
    ctx.lineTo(d1[0], d1[1]);
    ctx.lineTo(d2[0], d2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(aff[0], aff[1], aff[2], aff[3], aff[4], aff[5]);
    ctx.drawImage(media, 0, 0);
    ctx.restore();
  };

  var renderLayerTriangleWarp = function(layer) {
    if(!layer || !layer.element || !shouldUseTriangleWarp(layer)) {
      return false;
    }

    ensureLayerMesh(layer);
    var srcPts = getLayerMeshSourcePoints(layer);
    var dstPts = layer.mesh && layer.mesh.points ? layer.mesh.points : null;
    if(!srcPts || !dstPts || srcPts.length !== dstPts.length || srcPts.length < 4) {
      return false;
    }

    var mediaSize = getLayerMediaDrawSize(layer);
    if(!mediaSize) {
      return false;
    }

    var tc = ensureLayerTriangleCanvas(layer);
    if(!tc || !layer.triangleContext) {
      return false;
    }

    resizeLayerTriangleCanvas(layer);
    var ctx = layer.triangleContext;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tc.width, tc.height);

    if(!layer.visible) {
      return true;
    }

    var sx = mediaSize.width / Math.max(1, layer.width);
    var sy = mediaSize.height / Math.max(1, layer.height);

    var cols = Math.max(1, Number(layer.mesh.columns || 1));
    var rows = Math.max(1, Number(layer.mesh.rows || 1));

    for(var r = 0; r < rows; r++) {
      for(var c = 0; c < cols; c++) {
        var i00 = meshPointIndex(cols, r, c);
        var i10 = meshPointIndex(cols, r, c + 1);
        var i11 = meshPointIndex(cols, r + 1, c + 1);
        var i01 = meshPointIndex(cols, r + 1, c);

        var s00 = [srcPts[i00][0] * sx, srcPts[i00][1] * sy];
        var s10 = [srcPts[i10][0] * sx, srcPts[i10][1] * sy];
        var s11 = [srcPts[i11][0] * sx, srcPts[i11][1] * sy];
        var s01 = [srcPts[i01][0] * sx, srcPts[i01][1] * sy];

        var d00 = dstPts[i00];
        var d10 = dstPts[i10];
        var d11 = dstPts[i11];
        var d01 = dstPts[i01];

        drawTexturedTriangle(ctx, layer.element, s00, s10, s11, d00, d10, d11);
        drawTexturedTriangle(ctx, layer.element, s00, s11, s01, d00, d11, d01);
      }
    }

    return true;
  };

  var renderTriangleWarpFrame = function() {
    for(var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var active = renderLayerTriangleWarp(layer);
      layer.triangleWarpActive = !!active;

      if(layer.triangleCanvas) {
        layer.triangleCanvas.style.display = (layer.visible && layer.triangleWarpActive) ? 'block' : 'none';
      }

      if(layer.triangleWarpActive && layer.visible) {
        layer.element.style.visibility = 'hidden';
        if(layer.edgeBlendOverlay) {
          layer.edgeBlendOverlay.style.visibility = 'hidden';
        }
      } else if(layer.visible) {
        layer.element.style.visibility = 'visible';
        if(layer.edgeBlendOverlay) {
          layer.edgeBlendOverlay.style.visibility = 'visible';
        }
      } else {
        layer.element.style.visibility = 'hidden';
        if(layer.edgeBlendOverlay) {
          layer.edgeBlendOverlay.style.visibility = 'hidden';
        }
      }
    }
  };

  var startTriangleWarpLoop = function() {
    if(triangleWarpRaf != null) {
      return;
    }

    var tick = function() {
      renderTriangleWarpFrame();
      triangleWarpRaf = window.requestAnimationFrame(tick);
    };
    tick();
  };
  var drawLayerMesh = function(layer) {
    if(!layer || !layer.mesh || !layer.mesh.points || layer.mesh.points.length === 0) {
      return;
    }
    if(layer.mesh.columns <= 1 && layer.mesh.rows <= 1) {
      return;
    }

    var cols = layer.mesh.columns;
    var rows = layer.mesh.rows;
    var pts = layer.mesh.points;

    context.strokeStyle = '#f6b21a';
    context.lineWidth = 1;

    for(var r = 0; r <= rows; r++) {
      context.beginPath();
      for(var c = 0; c <= cols; c++) {
        var p = pts[meshPointIndex(cols, r, c)];
        if(c === 0) {
          context.moveTo(p[0], p[1]);
        } else {
          context.lineTo(p[0], p[1]);
        }
      }
      context.stroke();
    }

    for(var c2 = 0; c2 <= cols; c2++) {
      context.beginPath();
      for(var r2 = 0; r2 <= rows; r2++) {
        var p2 = pts[meshPointIndex(cols, r2, c2)];
        if(r2 === 0) {
          context.moveTo(p2[0], p2[1]);
        } else {
          context.lineTo(p2[0], p2[1]);
        }
      }
      context.stroke();
    }

    for(var i = 0; i < pts.length; i++) {
      var point = pts[i];
      context.beginPath();
      context.strokeStyle = hasPointReference(selectedMeshPoints, point) ? '#00ffd0' : '#f6b21a';
      context.arc(point[0], point[1], 5, 0, 2 * Math.PI, false);
      context.stroke();
    }
  };
  var draw = function() {
	  if(!configActive){
	    return;
	  }
	  
	  context.strokeStyle = "red";
	  context.lineWidth = 2;
	  context.clearRect(0, 0, canvas.width, canvas.height);	  
	  
	  for(var i = 0; i < layers.length; i++) {
	    
	  	if(layers[i].visible){
        if(layers[i].triangleWarpActive) {
          layers[i].element.style.visibility = "hidden";
          if(layers[i].triangleCanvas) { layers[i].triangleCanvas.style.display = "block"; }
        } else {
          layers[i].element.style.visibility = "visible";
          if(layers[i].triangleCanvas) { layers[i].triangleCanvas.style.display = "none"; }
        }
        if(layers[i].edgeBlendOverlay) { layers[i].edgeBlendOverlay.style.visibility = layers[i].triangleWarpActive ? "hidden" : "visible"; }

		    // Draw layer rectangles.
		    context.beginPath();
		    if(layers[i] === hoveringLayer){
		      context.strokeStyle = "red";
		    } else if(layers[i] === selectedLayer){
		      context.strokeStyle = "red";
		    } else {
		      context.strokeStyle = "white";
		    }
		    context.moveTo(layers[i].targetPoints[0][0], layers[i].targetPoints[0][1]);
		    for(var p = 0; p < layers[i].targetPoints.length; p++) {
		      context.lineTo(layers[i].targetPoints[p][0], layers[i].targetPoints[p][1]);
		    }
		    context.lineTo(layers[i].targetPoints[3][0], layers[i].targetPoints[3][1]);
		    context.closePath();
		    context.stroke();

		    // Draw corner points.
        var centerPoint = [0,0];
        var showLayerCornerHandles = !(layers[i] === selectedLayer && layers[i].mesh && (layers[i].mesh.columns > 1 || layers[i].mesh.rows > 1));
		    for(var p = 0; p < layers[i].targetPoints.length; p++) {

		      if(layers[i].targetPoints[p] === hoveringPoint){
		        context.strokeStyle = "red";
		      } else if( layers[i].targetPoints[p] === selectedPoint ) {
		        context.strokeStyle = "red";
		      } else {
		        context.strokeStyle = "white";
		      }
		      
		      centerPoint[0] += layers[i].targetPoints[p][0];
		      centerPoint[1] += layers[i].targetPoints[p][1];
		      
		      if(showLayerCornerHandles) {
          context.beginPath();
          context.arc(layers[i].targetPoints[p][0], layers[i].targetPoints[p][1], selectionRadius / 2, 0, 2 * Math.PI, false);
          context.stroke();
        }
		    }

		    // Find the average of the corner locations for an approximate center.
		    centerPoint[0] /= 4;
		    centerPoint[1] /= 4;


		    if(layers[i] === selectedLayer) {
        ensureLayerMesh(layers[i]);
        drawLayerMesh(layers[i]);
      }

      if(showLayerNames) {
		      // Draw the element ID in the center of the quad for reference.
		      var label = layers[i].element.id.toUpperCase();
		      context.font="16px sans-serif";
		      context.textAlign = "center";
		      var metrics = context.measureText(label);
		      var size = [metrics.width + 8, 16 + 16]
		      context.fillStyle = "white";
		      context.fillRect(centerPoint[0] - size[0] / 2, centerPoint[1] - size[1] + 8, size[0], size[1]);
		      context.fillStyle = "black";
		      context.fillText(label, centerPoint[0], centerPoint[1]);
		    }
	    } else {
        layers[i].element.style.visibility = "hidden";
        if(layers[i].triangleCanvas) { layers[i].triangleCanvas.style.display = "none"; }
        if(layers[i].edgeBlendOverlay) { layers[i].edgeBlendOverlay.style.visibility = "hidden"; }
      }
	  }

	  // Draw mouse crosshairs
	  if(showCrosshairs) {
	    context.strokeStyle = "yellow";
	    context.lineWidth = 1;
	    
	    context.beginPath();
	    
	    context.moveTo(mousePosition[0], 0);
	    context.lineTo(mousePosition[0], canvas.height);

	    context.moveTo(0, mousePosition[1]);
	    context.lineTo(canvas.width, mousePosition[1]);
	    
	    context.stroke();
	  }

	  if(showScreenBounds) {

	  	context.fillStyle = "black";
	    context.lineWidth = 4;
	  	context.fillRect(0,0,canvas.width,canvas.height);
	  	
	  	context.strokeStyle = "#909090";
	  	context.beginPath();
	  	var stepX = canvas.width / 10;
	  	var stepY = canvas.height / 10;

	  	for(var i = 0; i < 10; i++) {
	  		context.moveTo(i * stepX, 0);
	    	context.lineTo(i * stepX, canvas.height);

	    	context.moveTo(0, i * stepY);
	    	context.lineTo(canvas.width, i * stepY);
			}
	    context.stroke();
			
			context.strokeStyle = "white";
	    context.strokeRect(2, 2, canvas.width-4,canvas.height-4);

	    var fontSize = Math.round(stepY * 0.6);
	    context.font = fontSize + "px mono,sans-serif";
	    context.fillRect(stepX*2+2, stepY*3+2, canvas.width-stepX*4-4, canvas.height-stepY*6-4);
	    context.fillStyle = "white";
	    context.fontSize = 20;
	    context.fillText(canvas.width + " x " + canvas.height, canvas.width/2, canvas.height/2 + (fontSize * 0.75));
	    context.fillText('display size', canvas.width/2, canvas.height/2 - (fontSize * 0.75));
	  }
	};

	var swapLayerPoints = function(layerPoints, index1, index2){
		var tx = layerPoints[index1][0];
		var ty = layerPoints[index1][1];
		layerPoints[index1][0] = layerPoints[index2][0];
		layerPoints[index1][1] = layerPoints[index2][1];
		layerPoints[index2][0] = tx;
		layerPoints[index2][1] = ty;
	}

	var init = function(){
	  canvas = document.createElement('canvas');
	  
	  canvas.style.display = 'none';
	  canvas.style.position = 'fixed';
	  canvas.style.top = '0px';
	  canvas.style.left = '0px';
	  canvas.style.zIndex = '1000000';

	  context = canvas.getContext('2d');

	  document.body.appendChild(canvas);
    createIOControls();
	  
	  window.addEventListener('resize', resize );
	  
	  // UI events
	  window.addEventListener('mousemove', mouseMove);
	  window.addEventListener('mouseup', mouseUp);
	  window.addEventListener('mousedown', mouseDown);
	  window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keydown', globalShortcutHandler, true);
    document.addEventListener('keydown', globalShortcutHandler, true);
    document.addEventListener('pointerdown', function() {
      try { window.focus(); } catch (e) {}
    }, true);
    document.addEventListener('mousedown', function(event) {
      uiControlDragActive = isFormControlTarget(event.target);
    }, true);
    window.addEventListener('mouseup', function() {
      uiControlDragActive = false;
    }, true);
    window.addEventListener('blur', function() {
      uiControlDragActive = false;
    }, true);
    startScheduleTicker();
    startTriangleWarpLoop();

	  resize();
	};

  var createIOControls = function() {
    ioButton = document.createElement('button');
    ioButton.type = 'button';
    ioButton.textContent = 'I/O';
    ioButton.style.position = 'fixed';
    ioButton.style.top = '16px';
    ioButton.style.right = '16px';
    ioButton.style.zIndex = '1000002';
    ioButton.style.display = 'none';
    ioButton.style.padding = '8px 12px';
    ioButton.style.fontFamily = 'monospace';
    ioButton.style.fontSize = '13px';
    ioButton.style.background = '#111';
    ioButton.style.color = '#fff';
    ioButton.style.border = '1px solid #fff';
    ioButton.style.cursor = 'pointer';

    ioPanel = document.createElement('div');
    ioPanel.style.position = 'fixed';
    ioPanel.style.top = '48px';
    ioPanel.style.right = '16px';
    ioPanel.style.zIndex = '1000002';
    ioPanel.style.display = 'none';
    ioPanel.style.width = '320px';
    ioPanel.style.padding = '10px';
    ioPanel.style.background = 'rgba(0,0,0,0.85)';
    ioPanel.style.border = '1px solid #fff';
    ioPanel.style.fontFamily = 'monospace';
    ioPanel.style.color = '#fff';

    var sectionTitle = document.createElement('div');
    sectionTitle.textContent = 'Tambah Source';
    sectionTitle.style.marginBottom = '8px';
    sectionTitle.style.fontWeight = 'bold';
    ioPanel.appendChild(sectionTitle);

    var videoRow = document.createElement('div');
    videoRow.style.marginBottom = '10px';
    var addFileBtn = document.createElement('button');
    addFileBtn.type = 'button';
    addFileBtn.textContent = 'Pilih File';
    addFileBtn.style.width = '100%';
    addFileBtn.style.padding = '8px';
    addFileBtn.style.cursor = 'pointer';
    ioFileInput = document.createElement('input');
    ioFileInput.type = 'file';
    ioFileInput.accept = 'video/*,image/*,.gif,.html,.htm,text/html';
    ioFileInput.style.display = 'none';
    videoRow.appendChild(addFileBtn);
    videoRow.appendChild(ioFileInput);
    ioPanel.appendChild(videoRow);

    var webRow = document.createElement('div');
    ioUrlInput = document.createElement('input');
    ioUrlInput.type = 'text';
    ioUrlInput.placeholder = 'https://example.com';
    ioUrlInput.style.width = '100%';
    ioUrlInput.style.marginBottom = '6px';
    ioUrlInput.style.padding = '6px';
    ioUrlInput.style.boxSizing = 'border-box';
    var addWebBtn = document.createElement('button');
    addWebBtn.type = 'button';
    addWebBtn.textContent = 'Buka Halaman Web';
    addWebBtn.style.width = '100%';
    addWebBtn.style.padding = '8px';
    addWebBtn.style.cursor = 'pointer';
    webRow.appendChild(ioUrlInput);
    webRow.appendChild(addWebBtn);
    ioPanel.appendChild(webRow);
    var layerRow = document.createElement('div');
    layerRow.style.marginTop = '10px';
    var duplicateBtn = document.createElement('button');
    duplicateBtn.type = 'button';
    duplicateBtn.textContent = 'Duplicate Layer Terpilih';
    duplicateBtn.style.width = '100%';
    duplicateBtn.style.padding = '8px';
    duplicateBtn.style.marginBottom = '6px';
    duplicateBtn.style.cursor = 'pointer';
    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete Layer Terpilih';
    deleteBtn.style.width = '100%';
    deleteBtn.style.padding = '8px';
    deleteBtn.style.cursor = 'pointer';
    layerRow.appendChild(duplicateBtn);
    layerRow.appendChild(deleteBtn);
    ioPanel.appendChild(layerRow);
        var openSliceEditorBtn = document.createElement('button');
    openSliceEditorBtn.type = 'button';
    openSliceEditorBtn.textContent = 'Slice Editor (Popup)';
    openSliceEditorBtn.style.width = '100%';
    openSliceEditorBtn.style.padding = '8px';
    openSliceEditorBtn.style.marginTop = '10px';
    openSliceEditorBtn.style.cursor = 'pointer';
    ioPanel.appendChild(openSliceEditorBtn);

    var openScheduleEditorBtn = document.createElement('button');
    openScheduleEditorBtn.type = 'button';
    openScheduleEditorBtn.textContent = 'Schedule Clip (Popup)';
    openScheduleEditorBtn.style.width = '100%';
    openScheduleEditorBtn.style.padding = '8px';
    openScheduleEditorBtn.style.marginTop = '6px';
    openScheduleEditorBtn.style.cursor = 'pointer';
    ioPanel.appendChild(openScheduleEditorBtn);

    var saveAsBtn = document.createElement('button');
    saveAsBtn.type = 'button';
    saveAsBtn.textContent = 'Save As HTML';
    saveAsBtn.style.width = '100%';
    saveAsBtn.style.padding = '8px';
    saveAsBtn.style.marginTop = '6px';
    saveAsBtn.style.cursor = 'pointer';
    ioPanel.appendChild(saveAsBtn);

    var exportFolderBtn = document.createElement('button');
    exportFolderBtn.type = 'button';
    exportFolderBtn.textContent = 'Export Folder';
    exportFolderBtn.style.width = '100%';
    exportFolderBtn.style.padding = '8px';
    exportFolderBtn.style.marginTop = '6px';
    exportFolderBtn.style.cursor = 'pointer';
    ioPanel.appendChild(exportFolderBtn);

    var exportDownloaderBtn = document.createElement('button');
    exportDownloaderBtn.type = 'button';
    exportDownloaderBtn.textContent = 'Export + Downloader';
    exportDownloaderBtn.style.width = '100%';
    exportDownloaderBtn.style.padding = '8px';
    exportDownloaderBtn.style.marginTop = '6px';
    exportDownloaderBtn.style.cursor = 'pointer';
    ioPanel.appendChild(exportDownloaderBtn);

    ioSlicePopup = document.createElement('div');
    ioSlicePopup.style.position = 'fixed';
    ioSlicePopup.style.left = '50%';
    ioSlicePopup.style.top = '50%';
    ioSlicePopup.style.transform = 'translate(-50%, -50%)';
    ioSlicePopup.style.zIndex = '1000003';
    ioSlicePopup.style.display = 'none';
    ioSlicePopup.style.width = '440px';
    ioSlicePopup.style.maxWidth = '92vw';
    ioSlicePopup.style.padding = '12px';
    ioSlicePopup.style.background = 'rgba(0,0,0,0.92)';
    ioSlicePopup.style.border = '1px solid #fff';
    ioSlicePopup.style.color = '#fff';
    ioSlicePopup.style.fontFamily = 'monospace';

    var slicePopupTitle = document.createElement('div');
    slicePopupTitle.textContent = 'Slice/Crop Editor (Click + Drag)';
    slicePopupTitle.style.marginBottom = '8px';
    slicePopupTitle.style.fontWeight = 'bold';
    ioSlicePopup.appendChild(slicePopupTitle);

    var sliceHint = document.createElement('div');
    sliceHint.textContent = 'Drag area kosong: crop baru. Drag di dalam box: move. Drag sudut box: resize.';
    sliceHint.style.fontSize = '12px';
    sliceHint.style.marginBottom = '8px';
    ioSlicePopup.appendChild(sliceHint);

    ioSlicePreview = document.createElement('div');
    ioSlicePreview.style.position = 'relative';
    ioSlicePreview.style.width = '100%';
    ioSlicePreview.style.height = '240px';
    ioSlicePreview.style.border = '1px solid rgba(255,255,255,0.4)';
    ioSlicePreview.style.background = 'repeating-linear-gradient(45deg, #2a2a2a 0px, #2a2a2a 12px, #1e1e1e 12px, #1e1e1e 24px)';
    ioSlicePreview.style.cursor = 'crosshair';
    ioSlicePreview.style.overflow = 'hidden';


    ioSliceBox = document.createElement('div');
    ioSliceBox.style.position = 'absolute';
    ioSliceBox.style.border = '2px solid #00ffd0';
    ioSliceBox.style.background = 'rgba(0, 255, 208, 0.12)';
    ioSliceBox.style.pointerEvents = 'none';
    ioSlicePreview.appendChild(ioSliceBox);
    ioSliceCornerHandles = {
      nw: document.createElement('div'),
      ne: document.createElement('div'),
      se: document.createElement('div'),
      sw: document.createElement('div')
    };

    var cornerKeys = ['nw', 'ne', 'se', 'sw'];
    for(var ci = 0; ci < cornerKeys.length; ci++) {
      var ch = ioSliceCornerHandles[cornerKeys[ci]];
      ch.style.position = 'absolute';
      ch.style.width = '12px';
      ch.style.height = '12px';
      ch.style.border = '2px solid #ffffff';
      ch.style.background = '#111';
      ch.style.borderRadius = '50%';
      ch.style.transform = 'translate(-50%, -50%)';
      ch.style.boxSizing = 'border-box';
      ch.dataset.handle = cornerKeys[ci];
      ioSlicePreview.appendChild(ch);
    }

    ioSlicePopup.appendChild(ioSlicePreview);

    var sliceBtnRow = document.createElement('div');
    sliceBtnRow.style.display = 'grid';
    sliceBtnRow.style.gridTemplateColumns = '1fr 1fr 1fr';
    sliceBtnRow.style.gap = '6px';
    sliceBtnRow.style.marginTop = '10px';

    var sliceApplyBtn = document.createElement('button');
    sliceApplyBtn.type = 'button';
    sliceApplyBtn.textContent = 'Apply';
    sliceApplyBtn.style.padding = '8px';

    var sliceResetBtn = document.createElement('button');
    sliceResetBtn.type = 'button';
    sliceResetBtn.textContent = 'Reset';
    sliceResetBtn.style.padding = '8px';

    var sliceCloseBtn = document.createElement('button');
    sliceCloseBtn.type = 'button';
    sliceCloseBtn.textContent = 'Close';
    sliceCloseBtn.style.padding = '8px';

    sliceBtnRow.appendChild(sliceApplyBtn);
    sliceBtnRow.appendChild(sliceResetBtn);
    sliceBtnRow.appendChild(sliceCloseBtn);
    ioSlicePopup.appendChild(sliceBtnRow);
    var subdivisionWrap = document.createElement('div');
    subdivisionWrap.style.marginTop = '10px';
    subdivisionWrap.style.paddingTop = '10px';
    subdivisionWrap.style.borderTop = '1px solid rgba(255,255,255,0.25)';

    var subdivisionTitle = document.createElement('div');
    subdivisionTitle.textContent = 'Subdivision';
    subdivisionTitle.style.fontWeight = 'bold';
    subdivisionTitle.style.marginBottom = '6px';
    subdivisionWrap.appendChild(subdivisionTitle);

    var subdivisionRow = document.createElement('div');
    subdivisionRow.style.display = 'grid';
    subdivisionRow.style.gridTemplateColumns = '1fr 20px 1fr 88px';
    subdivisionRow.style.gap = '8px';
    subdivisionRow.style.alignItems = 'center';

    var createSubdivisionStepper = function() {
      var wrap = document.createElement('div');
      wrap.style.display = 'grid';
      wrap.style.gridTemplateColumns = '30px 64px 30px';
      wrap.style.gap = '4px';
      wrap.style.alignItems = 'center';
      wrap.style.justifyContent = 'center';

      var dec = document.createElement('button');
      dec.type = 'button';
      dec.textContent = '-';
      dec.style.height = '30px';
      dec.style.padding = '0';
      dec.style.fontWeight = 'bold';
      dec.style.lineHeight = '1';

      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[0-9]*';
      input.style.height = '30px';
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      input.style.textAlign = 'center';
      input.style.padding = '4px 6px';
      input.style.fontFamily = 'monospace';
      input.style.fontSize = '13px';

      var inc = document.createElement('button');
      inc.type = 'button';
      inc.textContent = '+';
      inc.style.height = '30px';
      inc.style.padding = '0';
      inc.style.fontWeight = 'bold';
      inc.style.lineHeight = '1';

      wrap.appendChild(dec);
      wrap.appendChild(input);
      wrap.appendChild(inc);

      return { wrap: wrap, input: input, dec: dec, inc: inc };
    };

    var colsStepper = createSubdivisionStepper();

    var subdivisionX = document.createElement('div');
    subdivisionX.textContent = 'x';
    subdivisionX.style.textAlign = 'center';
    subdivisionX.style.fontWeight = 'bold';
    subdivisionX.style.opacity = '0.85';

    var rowsStepper = createSubdivisionStepper();

    var subdivisionReset = document.createElement('button');
    subdivisionReset.type = 'button';
    subdivisionReset.textContent = 'Reset';
    subdivisionReset.style.height = '30px';
    subdivisionReset.style.padding = '0 8px';
    subdivisionReset.style.fontSize = '12px';

    subdivisionRow.appendChild(colsStepper.wrap);
    subdivisionRow.appendChild(subdivisionX);
    subdivisionRow.appendChild(rowsStepper.wrap);
    subdivisionRow.appendChild(subdivisionReset);
    subdivisionWrap.appendChild(subdivisionRow);

    ioSubdivisionControls = {
      columns: colsStepper.input,
      rows: rowsStepper.input,
      columnsDec: colsStepper.dec,
      columnsInc: colsStepper.inc,
      rowsDec: rowsStepper.dec,
      rowsInc: rowsStepper.inc,
      reset: subdivisionReset
    };

    ioSlicePopup.appendChild(subdivisionWrap);

    var edgeBlendWrap = document.createElement('div');
    edgeBlendWrap.style.marginTop = '10px';
    edgeBlendWrap.style.paddingTop = '10px';
    edgeBlendWrap.style.borderTop = '1px solid rgba(255,255,255,0.25)';

    var edgeBlendTitle = document.createElement('div');
    edgeBlendTitle.textContent = 'Edge Blending';
    edgeBlendTitle.style.fontWeight = 'bold';
    edgeBlendTitle.style.marginBottom = '6px';
    edgeBlendWrap.appendChild(edgeBlendTitle);

    var edgeEnableRow = document.createElement('label');
    edgeEnableRow.style.display = 'flex';
    edgeEnableRow.style.alignItems = 'center';
    edgeEnableRow.style.gap = '8px';
    edgeEnableRow.style.marginBottom = '8px';

    var edgeEnableInput = document.createElement('input');
    edgeEnableInput.type = 'checkbox';
    var edgeEnableText = document.createElement('span');
    edgeEnableText.textContent = 'Soft Edge';
    edgeEnableRow.appendChild(edgeEnableInput);
    edgeEnableRow.appendChild(edgeEnableText);
    edgeBlendWrap.appendChild(edgeEnableRow);

    ioEdgeBlendControls = {
      enabled: edgeEnableInput,
      gamma: null,
      sides: {}
    };

    var createEdgeSideRow = function(label, key) {
      var row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '56px 1fr 66px 1fr 56px';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      row.style.marginBottom = '6px';

      var checkWrap = document.createElement('label');
      checkWrap.style.display = 'flex';
      checkWrap.style.alignItems = 'center';
      checkWrap.style.gap = '4px';
      var check = document.createElement('input');
      check.type = 'checkbox';
      var checkText = document.createElement('span');
      checkText.textContent = label;
      checkWrap.appendChild(check);
      checkWrap.appendChild(checkText);

      var widthRange = document.createElement('input');
      widthRange.type = 'range';
      widthRange.min = '0';
      widthRange.max = '800';
      widthRange.step = '1';

      var widthNumber = document.createElement('input');
      widthNumber.type = 'number';
      widthNumber.min = '0';
      widthNumber.max = '800';
      widthNumber.step = '1';
      widthNumber.style.width = '100%';

      var smoothRange = document.createElement('input');
      smoothRange.type = 'range';
      smoothRange.min = '0';
      smoothRange.max = '1';
      smoothRange.step = '0.01';

      var smoothNumber = document.createElement('input');
      smoothNumber.type = 'number';
      smoothNumber.min = '0';
      smoothNumber.max = '1';
      smoothNumber.step = '0.01';
      smoothNumber.style.width = '100%';

      row.appendChild(checkWrap);
      row.appendChild(widthRange);
      row.appendChild(widthNumber);
      row.appendChild(smoothRange);
      row.appendChild(smoothNumber);

      edgeBlendWrap.appendChild(row);

      ioEdgeBlendControls.sides[key] = {
        enabled: check,
        widthRange: widthRange,
        widthNumber: widthNumber,
        smoothRange: smoothRange,
        smoothNumber: smoothNumber
      };
    };

    createEdgeSideRow('Left', 'left');
    createEdgeSideRow('Right', 'right');
    createEdgeSideRow('Top', 'top');
    createEdgeSideRow('Bottom', 'bottom');

    var gammaRow = document.createElement('div');
    gammaRow.style.display = 'grid';
    gammaRow.style.gridTemplateColumns = '120px 1fr 64px';
    gammaRow.style.gap = '8px';
    gammaRow.style.alignItems = 'center';
    gammaRow.style.marginTop = '8px';

    var gammaLabel = document.createElement('span');
    gammaLabel.textContent = 'Gamma';
    var gammaRange = document.createElement('input');
    gammaRange.type = 'range';
    gammaRange.min = '0.5';
    gammaRange.max = '3';
    gammaRange.step = '0.01';
    var gammaNumber = document.createElement('input');
    gammaNumber.type = 'number';
    gammaNumber.min = '0.5';
    gammaNumber.max = '3';
    gammaNumber.step = '0.01';
    gammaNumber.style.width = '100%';

    gammaRow.appendChild(gammaLabel);
    gammaRow.appendChild(gammaRange);
    gammaRow.appendChild(gammaNumber);
    edgeBlendWrap.appendChild(gammaRow);

    ioEdgeBlendControls.gamma = {
      range: gammaRange,
      number: gammaNumber
    };

    ioSlicePopup.appendChild(edgeBlendWrap);

    ioSchedulePopup = document.createElement('div');
    ioSchedulePopup.style.position = 'fixed';
    ioSchedulePopup.style.left = '50%';
    ioSchedulePopup.style.top = '50%';
    ioSchedulePopup.style.transform = 'translate(-50%, -50%)';
    ioSchedulePopup.style.zIndex = '1000003';
    ioSchedulePopup.style.display = 'none';
    ioSchedulePopup.style.width = '520px';
    ioSchedulePopup.style.maxWidth = '95vw';
    ioSchedulePopup.style.padding = '12px';
    ioSchedulePopup.style.background = 'rgba(0,0,0,0.92)';
    ioSchedulePopup.style.border = '1px solid #fff';
    ioSchedulePopup.style.color = '#fff';
    ioSchedulePopup.style.fontFamily = 'monospace';

    var scheduleTitle = document.createElement('div');
    scheduleTitle.textContent = 'Clip Schedule (Selected Layer)';
    scheduleTitle.style.marginBottom = '8px';
    scheduleTitle.style.fontWeight = 'bold';
    ioSchedulePopup.appendChild(scheduleTitle);

    var scheduleHint = document.createElement('div');
    scheduleHint.textContent = 'Tambahkan beberapa waktu trigger (HH:MM:SS) untuk layer terpilih.';
    scheduleHint.style.fontSize = '12px';
    scheduleHint.style.marginBottom = '8px';
    ioSchedulePopup.appendChild(scheduleHint);

    var scheduleTable = document.createElement('table');
    scheduleTable.style.width = '100%';
    scheduleTable.style.borderCollapse = 'collapse';
    scheduleTable.style.marginBottom = '8px';

    var scheduleHead = document.createElement('thead');
    var scheduleHeadRow = document.createElement('tr');
    ['#', 'Trigger', 'Delete'].forEach(function(label) {
      var th = document.createElement('th');
      th.textContent = label;
      th.style.textAlign = 'left';
      th.style.borderBottom = '1px solid rgba(255,255,255,0.4)';
      th.style.padding = '4px';
      scheduleHeadRow.appendChild(th);
    });
    scheduleHead.appendChild(scheduleHeadRow);
    scheduleTable.appendChild(scheduleHead);

    ioScheduleTableBody = document.createElement('tbody');
    scheduleTable.appendChild(ioScheduleTableBody);
    ioSchedulePopup.appendChild(scheduleTable);

    var scheduleBtnRow = document.createElement('div');
    scheduleBtnRow.style.display = 'grid';
    scheduleBtnRow.style.gridTemplateColumns = '1fr 1fr 1fr';
    scheduleBtnRow.style.gap = '6px';

    var scheduleAddRowBtn = document.createElement('button');
    scheduleAddRowBtn.type = 'button';
    scheduleAddRowBtn.textContent = 'Add Row';
    scheduleAddRowBtn.style.padding = '8px';

    var scheduleSaveBtn = document.createElement('button');
    scheduleSaveBtn.type = 'button';
    scheduleSaveBtn.textContent = 'Save';
    scheduleSaveBtn.style.padding = '8px';

    var scheduleCloseBtn = document.createElement('button');
    scheduleCloseBtn.type = 'button';
    scheduleCloseBtn.textContent = 'Close';
    scheduleCloseBtn.style.padding = '8px';

    scheduleBtnRow.appendChild(scheduleAddRowBtn);
    scheduleBtnRow.appendChild(scheduleSaveBtn);
    scheduleBtnRow.appendChild(scheduleCloseBtn);
    ioSchedulePopup.appendChild(scheduleBtnRow);    var helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.textContent = 'Help (Shortcut Info)';
    helpBtn.style.width = '100%';
    helpBtn.style.padding = '8px';
    helpBtn.style.marginTop = '8px';
    helpBtn.style.cursor = 'pointer';
    ioPanel.appendChild(helpBtn);

    ioHelpPopup = document.createElement('div');
    ioHelpPopup.style.position = 'fixed';
    ioHelpPopup.style.left = '50%';
    ioHelpPopup.style.top = '50%';
    ioHelpPopup.style.transform = 'translate(-50%, -50%)';
    ioHelpPopup.style.zIndex = '1000003';
    ioHelpPopup.style.display = 'none';
    ioHelpPopup.style.width = '420px';
    ioHelpPopup.style.maxWidth = '90vw';
    ioHelpPopup.style.padding = '12px';
    ioHelpPopup.style.background = 'rgba(0,0,0,0.92)';
    ioHelpPopup.style.border = '1px solid #fff';
    ioHelpPopup.style.color = '#fff';
    ioHelpPopup.style.fontFamily = 'monospace';
    ioHelpPopup.style.lineHeight = '1.4';

    var helpTitle = document.createElement('div');
    helpTitle.textContent = 'Shortcut Info';
    helpTitle.style.fontWeight = 'bold';
    helpTitle.style.marginBottom = '8px';
    ioHelpPopup.appendChild(helpTitle);

    var helpText = document.createElement('pre');
    helpText.style.whiteSpace = 'pre-wrap';
    helpText.style.margin = '0';
    helpText.textContent =
      'SHIFT + Space  : Toggle edit mode\n' +
      'Drag           : Move selected point/quad\n' +
      'SHIFT + Drag   : Precision move\n' +
      'ALT + Drag     : Rotate + scale\n' +
      'Arrow keys     : Nudge selected\n' +
      'SHIFT + Arrow  : Nudge 10 px\n' +
      'ALT + Arrow    : Rotate/scale selected\n' +
      's              : Solo/unsolo selected layer\n' +
      'c              : Toggle crosshairs\n' +
      'b              : Toggle screen bounds\n' +
      'r              : Rotate 90 deg\n' +
      'h              : Flip horizontal\n' +
      'v              : Flip vertical';
    ioHelpPopup.appendChild(helpText);

    var closeHelpBtn = document.createElement('button');
    closeHelpBtn.type = 'button';
    closeHelpBtn.textContent = 'Close';
    closeHelpBtn.style.width = '100%';
    closeHelpBtn.style.padding = '8px';
    closeHelpBtn.style.marginTop = '10px';
    closeHelpBtn.style.cursor = 'pointer';
    ioHelpPopup.appendChild(closeHelpBtn);

    ioButton.addEventListener('click', function() {
      ioPanel.style.display = (ioPanel.style.display === 'none') ? 'block' : 'none';
    });

    addFileBtn.addEventListener('click', function() {
      ioFileInput.click();
    });

    ioFileInput.addEventListener('change', function(event) {
      if(event.target.files && event.target.files[0]) {
        addFileLayer(event.target.files[0]);
        ioFileInput.value = '';
      }
    });

    addWebBtn.addEventListener('click', function() {
      addWebLayer(ioUrlInput.value);
    });

    ioUrlInput.addEventListener('keydown', function(event) {
      if(event.keyCode === 13) {
        addWebLayer(ioUrlInput.value);
      }
    });
    duplicateBtn.addEventListener('click', function() {
      duplicateSelectedLayer();
    });

    deleteBtn.addEventListener('click', function() {
      deleteSelectedLayer();
    });
    openSliceEditorBtn.addEventListener('click', function() {
      openSliceEditorPopup();
    });

    openScheduleEditorBtn.addEventListener('click', function() {
      openScheduleEditorPopup();
    });

    saveAsBtn.addEventListener('click', async function() {
      await saveProjectAsHtml();
    });

    exportFolderBtn.addEventListener('click', async function() {
      await exportProjectFolder(false);
    });

    exportDownloaderBtn.addEventListener('click', async function() {
      await exportProjectFolder(true);
    });

    scheduleAddRowBtn.addEventListener('click', function() {
      appendScheduleRow('');
    });

    scheduleSaveBtn.addEventListener('click', function() {
      applyScheduleDraft();
    });

    scheduleCloseBtn.addEventListener('click', function() {
      ioSchedulePopup.style.display = 'none';
    });
    sliceApplyBtn.addEventListener('click', function() {
      applySliceDraft();
    });

    sliceResetBtn.addEventListener('click', function() {
      resetSliceForSelectedLayer();
    });

    sliceCloseBtn.addEventListener('click', function() {
      ioSlicePopup.style.display = 'none';
    });
    if(ioSubdivisionControls) {
      var lockSubdivisionInput = function(ev) {
        ev.stopPropagation();
      };

      var parseSubdivisionValue = function(input) {
        var raw = String(input.value || '').trim();
        if(raw === '') {
          return 1;
        }
        var v = Number(raw);
        if(isNaN(v)) {
          v = 1;
        }
        v = Math.max(1, Math.min(12, Math.round(v)));
        return v;
      };

      var setSubdivisionValue = function(input, v) {
        var nv = Math.max(1, Math.min(12, Math.round(Number(v) || 1)));
        input.value = String(nv);
      };

      var applySubdivisionFromInputs = function(resetMesh) {
        setSubdivisionValue(ioSubdivisionControls.columns, parseSubdivisionValue(ioSubdivisionControls.columns));
        setSubdivisionValue(ioSubdivisionControls.rows, parseSubdivisionValue(ioSubdivisionControls.rows));
        applySubdivisionDraft(!!resetMesh);
      };

      var stepSubdivisionInput = function(input, delta) {
        var base = parseSubdivisionValue(input);
        setSubdivisionValue(input, base + delta);
        applySubdivisionDraft(false);
      };

      var bindSubdivisionTextInput = function(input) {
        input.addEventListener('mousedown', lockSubdivisionInput);
        input.addEventListener('click', lockSubdivisionInput);
        input.addEventListener('pointerdown', lockSubdivisionInput);

        input.addEventListener('wheel', function(ev) {
          ev.preventDefault();
        }, { passive: false });

        input.addEventListener('change', function() {
          applySubdivisionFromInputs(false);
        });

        input.addEventListener('keydown', function(ev) {
          if(ev.key === 'Enter') {
            applySubdivisionFromInputs(false);
            return;
          }

          // Allow only numeric edit/navigation keys.
          var allowed = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
          if(allowed.indexOf(ev.key) >= 0) {
            return;
          }
          if(ev.key >= '0' && ev.key <= '9') {
            return;
          }
          ev.preventDefault();
        });
      };

      bindSubdivisionTextInput(ioSubdivisionControls.columns);
      bindSubdivisionTextInput(ioSubdivisionControls.rows);

      ioSubdivisionControls.columnsDec.addEventListener('click', function(ev) {
        lockSubdivisionInput(ev);
        stepSubdivisionInput(ioSubdivisionControls.columns, -1);
      });
      ioSubdivisionControls.columnsInc.addEventListener('click', function(ev) {
        lockSubdivisionInput(ev);
        stepSubdivisionInput(ioSubdivisionControls.columns, 1);
      });
      ioSubdivisionControls.rowsDec.addEventListener('click', function(ev) {
        lockSubdivisionInput(ev);
        stepSubdivisionInput(ioSubdivisionControls.rows, -1);
      });
      ioSubdivisionControls.rowsInc.addEventListener('click', function(ev) {
        lockSubdivisionInput(ev);
        stepSubdivisionInput(ioSubdivisionControls.rows, 1);
      });

      ioSubdivisionControls.reset.addEventListener('click', function() {
        applySubdivisionFromInputs(true);
      });
    }
    var bindEdgePair = function(rangeInput, numberInput) {
      rangeInput.addEventListener('input', function() {
        numberInput.value = rangeInput.value;
        applyEdgeBlendDraft();
      });
      numberInput.addEventListener('input', function() {
        rangeInput.value = numberInput.value;
        applyEdgeBlendDraft();
      });
    };

    edgeEnableInput.addEventListener('change', function() {
      applyEdgeBlendDraft();
    });

    var edgeKeys = ['left', 'right', 'top', 'bottom'];
    for(var ek = 0; ek < edgeKeys.length; ek++) {
      var edgeCtrl = ioEdgeBlendControls.sides[edgeKeys[ek]];
      edgeCtrl.enabled.addEventListener('change', function() {
        applyEdgeBlendDraft();
      });
      bindEdgePair(edgeCtrl.widthRange, edgeCtrl.widthNumber);
      bindEdgePair(edgeCtrl.smoothRange, edgeCtrl.smoothNumber);
    }

    bindEdgePair(gammaRange, gammaNumber);
    ioSlicePopup.addEventListener('mousedown', function(event) {
      if(ioSlicePreview && !ioSlicePreview.contains(event.target)) {
        sliceDragging = false;
      }
    }, true);

    window.addEventListener('keydown', function(event) {
      if(!ioSlicePopup || ioSlicePopup.style.display === 'none') {
        return;
      }
      if(!ioSliceSelectedHandle) {
        return;
      }
      var key = event.keyCode;
      if(key < 37 || key > 40) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      var step = event.shiftKey ? 10 : 1;
      var dx = 0;
      var dy = 0;
      if(key === 37) { dx = -step; }
      if(key === 38) { dy = -step; }
      if(key === 39) { dx = step; }
      if(key === 40) { dy = step; }
      nudgeSelectedSliceHandle(dx, dy);
    }, true);
        var sliceDragging = false;

    var toPreviewPoint = function(event) {
      var rect = ioSlicePreview.getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      var y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return { x: x, y: y };
    };

    var previewToSource = function(point) {
      if(!selectedLayer || !ioSlicePreviewMap) {
        return { x: 0, y: 0 };
      }
      var map = ioSlicePreviewMap;
      var rx = Math.max(0, Math.min(map.drawWidth, point.x - map.offsetX));
      var ry = Math.max(0, Math.min(map.drawHeight, point.y - map.offsetY));
      return {
        x: (rx / Math.max(1, map.drawWidth)) * selectedLayer.width,
        y: (ry / Math.max(1, map.drawHeight)) * selectedLayer.height
      };
    };

    var getSliceBoxPreviewRect = function() {
      if(!ioSliceDraftRect || !ioSlicePreviewMap || !selectedLayer) {
        return null;
      }
      var map = ioSlicePreviewMap;
      var sx = map.drawWidth / Math.max(1, selectedLayer.width);
      var sy = map.drawHeight / Math.max(1, selectedLayer.height);
      return {
        left: map.offsetX + ioSliceDraftRect.x * sx,
        top: map.offsetY + ioSliceDraftRect.y * sy,
        width: ioSliceDraftRect.width * sx,
        height: ioSliceDraftRect.height * sy
      };
    };

    var hitSliceBox = function(point) {
      var box = getSliceBoxPreviewRect();
      if(!box) {
        return false;
      }
      return point.x >= box.left && point.x <= (box.left + box.width) && point.y >= box.top && point.y <= (box.top + box.height);
    };

    var hitSliceHandle = function(point) {
      var box = getSliceBoxPreviewRect();
      if(!box) {
        return '';
      }
      var handles = [
        { mode: 'resize-nw', x: box.left, y: box.top },
        { mode: 'resize-ne', x: box.left + box.width, y: box.top },
        { mode: 'resize-se', x: box.left + box.width, y: box.top + box.height },
        { mode: 'resize-sw', x: box.left, y: box.top + box.height }
      ];
      for(var i = 0; i < handles.length; i++) {
        var dx = point.x - handles[i].x;
        var dy = point.y - handles[i].y;
        if((dx * dx) + (dy * dy) <= (ioSliceHandleRadius * ioSliceHandleRadius)) {
          return handles[i].mode;
        }
      }
      return '';
    };

    var clampSliceRect = function(rect) {
      if(!selectedLayer || !rect) {
        return rect;
      }

      var maxW = Math.max(1, selectedLayer.width);
      var maxH = Math.max(1, selectedLayer.height);

      rect.x = Math.max(0, Math.min(maxW - 1, rect.x));
      rect.y = Math.max(0, Math.min(maxH - 1, rect.y));
      rect.width = Math.max(1, Math.min(maxW - rect.x, rect.width));
      rect.height = Math.max(1, Math.min(maxH - rect.y, rect.height));

      return rect;
    };

    var normalizeRectFromCorners = function(left, top, right, bottom) {
      var nx1 = Math.min(left, right);
      var nx2 = Math.max(left, right);
      var ny1 = Math.min(top, bottom);
      var ny2 = Math.max(top, bottom);
      return {
        x: nx1,
        y: ny1,
        width: Math.max(1, nx2 - nx1),
        height: Math.max(1, ny2 - ny1)
      };
    };

    var nudgeSelectedSliceHandle = function(dx, dy) {
      if(!ioSliceDraftRect || !ioSliceSelectedHandle || ioSliceSelectedHandle.indexOf('resize-') !== 0) {
        return false;
      }

      var left = ioSliceDraftRect.x;
      var top = ioSliceDraftRect.y;
      var right = ioSliceDraftRect.x + ioSliceDraftRect.width;
      var bottom = ioSliceDraftRect.y + ioSliceDraftRect.height;

      if(ioSliceSelectedHandle === 'resize-nw' || ioSliceSelectedHandle === 'resize-sw') {
        left += dx;
      }
      if(ioSliceSelectedHandle === 'resize-ne' || ioSliceSelectedHandle === 'resize-se') {
        right += dx;
      }
      if(ioSliceSelectedHandle === 'resize-nw' || ioSliceSelectedHandle === 'resize-ne') {
        top += dy;
      }
      if(ioSliceSelectedHandle === 'resize-sw' || ioSliceSelectedHandle === 'resize-se') {
        bottom += dy;
      }

      ioSliceDraftRect = clampSliceRect(normalizeRectFromCorners(left, top, right, bottom));
      renderSliceDraftBox();
      applySliceDraft();
      return true;
    };
    var endSliceDrag = function(shouldApply) {
      if(sliceDragging && shouldApply && ioSlicePopup && ioSlicePopup.style.display !== 'none' && ioSliceDraftRect) {
        applySliceDraft();
      }
      sliceDragging = false;
      ioSliceDragStart = null;
      ioSliceDragRectStart = null;
      ioSliceDragMode = '';
    };

    ioSlicePreview.addEventListener('mousedown', function(event) {
      if(!selectedLayer) {
        return;
      }
      event.preventDefault();

      var p = toPreviewPoint(event);
      var srcPoint = previewToSource(p);
      var handleMode = hitSliceHandle(p);

      ioSliceDragStart = srcPoint;
      ioSliceDragRectStart = ioSliceDraftRect ? {
        x: ioSliceDraftRect.x,
        y: ioSliceDraftRect.y,
        width: ioSliceDraftRect.width,
        height: ioSliceDraftRect.height
      } : null;

      if(ioSliceDragRectStart && handleMode) {
        ioSliceDragMode = handleMode;
        ioSliceSelectedHandle = handleMode;
      } else if(ioSliceDragRectStart && hitSliceBox(p)) {
        ioSliceDragMode = 'move';
      } else {
        ioSliceSelectedHandle = '';
        ioSliceDragMode = 'draw';
        ioSliceDraftRect = {
          x: srcPoint.x,
          y: srcPoint.y,
          width: 1,
          height: 1
        };
      }

      sliceDragging = true;
      renderSliceDraftBox();
    });

    window.addEventListener('mousemove', function(event) {
      if(!ioSlicePopup || ioSlicePopup.style.display === 'none') {
        return;
      }

      if(sliceDragging && event.buttons === 0) {
        endSliceDrag(true);
      }

      var p = toPreviewPoint(event);
      var handleMode = hitSliceHandle(p);
      if(!sliceDragging) {
        if(handleMode === 'resize-nw' || handleMode === 'resize-se') {
          ioSlicePreview.style.cursor = 'nwse-resize';
        } else if(handleMode === 'resize-ne' || handleMode === 'resize-sw') {
          ioSlicePreview.style.cursor = 'nesw-resize';
        } else if(hitSliceBox(p)) {
          ioSlicePreview.style.cursor = 'move';
        } else {
          ioSlicePreview.style.cursor = 'crosshair';
        }
        return;
      }

      if(!selectedLayer) {
        return;
      }

      var srcPoint = previewToSource(p);

      if(ioSliceDragMode === 'draw') {
        var x1 = Math.min(ioSliceDragStart.x, srcPoint.x);
        var y1 = Math.min(ioSliceDragStart.y, srcPoint.y);
        var x2 = Math.max(ioSliceDragStart.x, srcPoint.x);
        var y2 = Math.max(ioSliceDragStart.y, srcPoint.y);
        ioSliceDraftRect = {
          x: x1,
          y: y1,
          width: Math.max(1, x2 - x1),
          height: Math.max(1, y2 - y1)
        };
      } else if(ioSliceDragMode === 'move' && ioSliceDragRectStart) {
        var dx = srcPoint.x - ioSliceDragStart.x;
        var dy = srcPoint.y - ioSliceDragStart.y;
        ioSliceDraftRect = {
          x: ioSliceDragRectStart.x + dx,
          y: ioSliceDragRectStart.y + dy,
          width: ioSliceDragRectStart.width,
          height: ioSliceDragRectStart.height
        };
      } else if(ioSliceDragRectStart && ioSliceDragMode.indexOf('resize-') === 0) {
        var left = ioSliceDragRectStart.x;
        var top = ioSliceDragRectStart.y;
        var right = ioSliceDragRectStart.x + ioSliceDragRectStart.width;
        var bottom = ioSliceDragRectStart.y + ioSliceDragRectStart.height;

        if(ioSliceDragMode === 'resize-nw' || ioSliceDragMode === 'resize-sw') {
          left = srcPoint.x;
        }
        if(ioSliceDragMode === 'resize-ne' || ioSliceDragMode === 'resize-se') {
          right = srcPoint.x;
        }
        if(ioSliceDragMode === 'resize-nw' || ioSliceDragMode === 'resize-ne') {
          top = srcPoint.y;
        }
        if(ioSliceDragMode === 'resize-sw' || ioSliceDragMode === 'resize-se') {
          bottom = srcPoint.y;
        }

        var nx1 = Math.min(left, right);
        var nx2 = Math.max(left, right);
        var ny1 = Math.min(top, bottom);
        var ny2 = Math.max(top, bottom);

        ioSliceDraftRect = {
          x: nx1,
          y: ny1,
          width: Math.max(1, nx2 - nx1),
          height: Math.max(1, ny2 - ny1)
        };
      }

      if(ioSliceDraftRect) {
        ioSliceDraftRect = clampSliceRect(ioSliceDraftRect);
      }

      renderSliceDraftBox();
    });

    window.addEventListener('mouseup', function() {
      endSliceDrag(true);
    });
    window.addEventListener('blur', function() {
      endSliceDrag(true);
    });
    ioSlicePreview.addEventListener('mouseleave', function() {
      if(sliceDragging) {
        endSliceDrag(true);
      }
    });

    helpBtn.addEventListener('click', function() {
      ioHelpPopup.style.display = 'block';
    });

    closeHelpBtn.addEventListener('click', function() {
      ioHelpPopup.style.display = 'none';
    });

    document.body.appendChild(ioButton);
    document.body.appendChild(ioPanel);
    document.body.appendChild(ioHelpPopup);
    document.body.appendChild(ioSlicePopup);
    document.body.appendChild(ioSchedulePopup);
  };

  var generateLayerId = function(prefix) {
    var id = '';
    do {
      id = prefix + '-' + dynamicLayerCounter++;
    } while(document.getElementById(id));
    return id;
  };

  var selectLayerByElement = function(element) {
    for(var i = 0; i < layers.length; i++) {
      if(layers[i].element === element) {
        selectedLayer = layers[i];
        selectedPoint = null;
        clearMeshSelection();
        refreshSliceInputs();
        refreshSubdivisionInputs();
        refreshEdgeBlendInputs();
        draw();
        return;
      }
    }
  };

  var readNumber = function(value, fallback) {
    var parsed = Number(value);
    return isNaN(parsed) ? fallback : parsed;
  };
  var updateSlicePreviewContent = function() {
    ioSlicePreviewMap = null;

    if(!ioSlicePreview || !selectedLayer) {
      return;
    }

    var pw = ioSlicePreview.clientWidth || 1;
    var ph = ioSlicePreview.clientHeight || 1;
    var lw = Math.max(1, selectedLayer.width);
    var lh = Math.max(1, selectedLayer.height);
    var scale = Math.min(pw / lw, ph / lh);
    var dw = lw * scale;
    var dh = lh * scale;
    var ox = (pw - dw) * 0.5;
    var oy = (ph - dh) * 0.5;

    ioSlicePreviewMap = {
      offsetX: ox,
      offsetY: oy,
      drawWidth: dw,
      drawHeight: dh
    };
  };  var renderSliceDraftBox = function() {
    if(!ioSlicePreview || !ioSliceBox || !selectedLayer || !ioSliceDraftRect || !ioSlicePreviewMap) {
      if(ioSliceBox) {
        ioSliceBox.style.display = 'none';
      }
      if(ioSliceCornerHandles) {
        var hideKeys = ['nw', 'ne', 'se', 'sw'];
        for(var hk = 0; hk < hideKeys.length; hk++) {
          if(ioSliceCornerHandles[hideKeys[hk]]) {
            ioSliceCornerHandles[hideKeys[hk]].style.display = 'none';
          }
        }
      }
      return;
    }

    var map = ioSlicePreviewMap;
    var sx = map.drawWidth / Math.max(1, selectedLayer.width);
    var sy = map.drawHeight / Math.max(1, selectedLayer.height);

    var left = map.offsetX + (ioSliceDraftRect.x * sx);
    var top = map.offsetY + (ioSliceDraftRect.y * sy);
    var width = Math.max(1, ioSliceDraftRect.width * sx);
    var height = Math.max(1, ioSliceDraftRect.height * sy);
    var right = left + width;
    var bottom = top + height;

    ioSliceBox.style.display = 'block';
    ioSliceBox.style.left = left + 'px';
    ioSliceBox.style.top = top + 'px';
    ioSliceBox.style.width = width + 'px';
    ioSliceBox.style.height = height + 'px';

    if(ioSliceCornerHandles) {
      var positions = {
        nw: [left, top],
        ne: [right, top],
        se: [right, bottom],
        sw: [left, bottom]
      };
      var keys = ['nw', 'ne', 'se', 'sw'];
      for(var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var handle = ioSliceCornerHandles[key];
        if(!handle) {
          continue;
        }
        handle.style.display = 'block';
        handle.style.left = positions[key][0] + 'px';
        handle.style.top = positions[key][1] + 'px';
        handle.style.borderColor = (ioSliceSelectedHandle === ('resize-' + key)) ? '#00ffd0' : '#ffffff';
      }
    }
  };

  var refreshSliceInputs = function() {
    updateSlicePreviewContent();
    if(!selectedLayer) {
      ioSliceSelectedHandle = '';
      ioSliceDraftRect = null;
      renderSliceDraftBox();
      return;
    }

    var slice = selectedLayer.slice || createDefaultSliceData(selectedLayer.width, selectedLayer.height);
    var rect = slice.sourceRect || {};
    ioSliceSelectedHandle = '';
    ioSliceDraftRect = {
      x: Number(rect.x || 0),
      y: Number(rect.y || 0),
      width: Number(rect.width || selectedLayer.width),
      height: Number(rect.height || selectedLayer.height)
    };
    renderSliceDraftBox();
  };

  var openSliceEditorPopup = function() {
    if(!selectedLayer) {
      return;
    }
    ioSlicePopup.style.display = 'block';
    updateSlicePreviewContent();
    refreshSliceInputs();
    refreshSubdivisionInputs();
    refreshEdgeBlendInputs();
  };

  var clearScheduleTableRows = function() {
    if(!ioScheduleTableBody) {
      return;
    }
    while(ioScheduleTableBody.firstChild) {
      ioScheduleTableBody.removeChild(ioScheduleTableBody.firstChild);
    }
  };

  var renumberScheduleRows = function() {
    if(!ioScheduleTableBody) {
      return;
    }
    var rows = ioScheduleTableBody.querySelectorAll('tr');
    for(var i = 0; i < rows.length; i++) {
      var idxCell = rows[i].querySelector('td');
      if(idxCell) {
        idxCell.textContent = String(i + 1);
      }
    }
  };

  var appendScheduleRow = function(timeValue) {
    if(!ioScheduleTableBody) {
      return;
    }

    var tr = document.createElement('tr');

    var idxTd = document.createElement('td');
    idxTd.style.padding = '4px';
    idxTd.style.width = '32px';
    idxTd.textContent = '0';
    tr.appendChild(idxTd);

    var timeTd = document.createElement('td');
    timeTd.style.padding = '4px';
    var timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.step = '1';
    timeInput.value = formatScheduleTime(timeValue || '');
    timeInput.style.width = '100%';
    timeInput.style.boxSizing = 'border-box';
    timeTd.appendChild(timeInput);
    tr.appendChild(timeTd);

    var delTd = document.createElement('td');
    delTd.style.padding = '4px';
    delTd.style.width = '76px';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.style.width = '100%';
    delBtn.style.padding = '6px';
    delBtn.addEventListener('click', function() {
      if(tr.parentNode) {
        tr.parentNode.removeChild(tr);
      }
      renumberScheduleRows();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    ioScheduleTableBody.appendChild(tr);
    renumberScheduleRows();
  };

  var openScheduleEditorPopup = function() {
    if(!selectedLayer) {
      return;
    }

    var schedule = normalizeScheduleData(selectedLayer.schedule);
    selectedLayer.schedule = schedule;

    clearScheduleTableRows();
    if(schedule.items.length === 0) {
      appendScheduleRow('');
    } else {
      for(var i = 0; i < schedule.items.length; i++) {
        appendScheduleRow(schedule.items[i].time);
      }
    }

    ioSchedulePopup.style.display = 'block';
  };

  var applyScheduleDraft = function() {
    if(!selectedLayer || !ioScheduleTableBody) {
      return;
    }

    var rows = ioScheduleTableBody.querySelectorAll('tr');
    var items = [];
    for(var i = 0; i < rows.length; i++) {
      var input = rows[i].querySelector('input[type="time"]');
      if(!input || !input.value) {
        continue;
      }
      var t = formatScheduleTime(input.value);
      if(t) {
        items.push({ time: t });
      }
    }

    selectedLayer.schedule = normalizeScheduleData({ enabled: true, items: items });
    ioSchedulePopup.style.display = 'none';

    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  };

  var triggerScheduledLayer = function(layer) {
    if(!layer || !layer.element) {
      return;
    }

    if(layer.element.tagName === 'VIDEO') {
      try {
        layer.element.currentTime = 0;
      } catch(e) {}
      layer.element.play();
      return;
    }

    if(layer.element.tagName === 'IMG') {
      var currentSrc = layer.element.src;
      layer.element.src = '';
      layer.element.src = currentSrc;
      return;
    }

    if(layer.element.tagName === 'IFRAME') {
      layer.element.style.visibility = 'visible';
      if(layer.edgeBlendOverlay) { layer.edgeBlendOverlay.style.visibility = 'visible'; }
      return;
    }

    layer.element.style.visibility = 'visible';
      if(layer.edgeBlendOverlay) { layer.edgeBlendOverlay.style.visibility = 'visible'; }
  };

  var checkScheduleTriggers = function() {
    if(!layers || layers.length === 0) {
      return;
    }

    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    var currentTime = hh + ':' + mm + ':' + ss;
    var dayKey = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if(scheduleActiveDay !== dayKey) {
      scheduleActiveDay = dayKey;
      scheduleLastTriggerMap = {};
    }

    for(var i = 0; i < layers.length; i++) {
      var schedule = normalizeScheduleData(layers[i].schedule);
      layers[i].schedule = schedule;
      if(!schedule.enabled || !schedule.items || schedule.items.length === 0) {
        continue;
      }

      for(var n = 0; n < schedule.items.length; n++) {
        var time = formatScheduleTime(schedule.items[n].time);
        if(time !== currentTime) {
          continue;
        }

        var triggerKey = layers[i].element.id + '|' + dayKey + '|' + time;
        if(scheduleLastTriggerMap[triggerKey]) {
          continue;
        }

        scheduleLastTriggerMap[triggerKey] = true;
        triggerScheduledLayer(layers[i]);
      }
    }
  };

  var startScheduleTicker = function() {
    if(scheduleTickTimer) {
      clearInterval(scheduleTickTimer);
    }
    scheduleTickTimer = setInterval(function() {
      checkScheduleTriggers();
    }, 250);
  };

  var refreshSubdivisionInputs = function() {
    if(!ioSubdivisionControls || !selectedLayer) {
      return;
    }
    ensureLayerMesh(selectedLayer);
    ioSubdivisionControls.columns.value = String(selectedLayer.mesh.columns || 1);
    ioSubdivisionControls.rows.value = String(selectedLayer.mesh.rows || 1);
  };

  var applySubdivisionDraft = function(resetMesh) {
    if(!selectedLayer || !ioSubdivisionControls) {
      return;
    }

    var cols = Math.max(1, Math.min(12, Number(ioSubdivisionControls.columns.value || 1)));
    var rows = Math.max(1, Math.min(12, Number(ioSubdivisionControls.rows.value || 1)));
    ioSubdivisionControls.columns.value = String(cols);
    ioSubdivisionControls.rows.value = String(rows);

    if(resetMesh === true || !selectedLayer.mesh || selectedLayer.mesh.columns !== cols || selectedLayer.mesh.rows !== rows) {
      rebuildLayerMeshFromTarget(selectedLayer, cols, rows);
    } else {
      ensureLayerMesh(selectedLayer);
    }

    draw();
    if(autoSave) {
      saveSettings();
    }
    notifyChangeListener();
  };
  var refreshEdgeBlendInputs = function() {
    if(!ioEdgeBlendControls || !selectedLayer) {
      return;
    }

    var edge = normalizeEdgeBlendData(selectedLayer.edgeBlend);
    selectedLayer.edgeBlend = edge;

    ioEdgeBlendControls.enabled.checked = !!edge.enabled;
    var keys = ['left', 'right', 'top', 'bottom'];
    for(var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var ctrl = ioEdgeBlendControls.sides[k];
      var side = edge.sides[k];
      ctrl.enabled.checked = !!side.enabled;
      ctrl.widthRange.value = String(side.width);
      ctrl.widthNumber.value = String(side.width);
      ctrl.smoothRange.value = String(side.smooth);
      ctrl.smoothNumber.value = String(side.smooth);
    }

    ioEdgeBlendControls.gamma.range.value = String(edge.gamma);
    ioEdgeBlendControls.gamma.number.value = String(edge.gamma);
  };

  var readEdgeBlendFromInputs = function() {
    if(!ioEdgeBlendControls) {
      return createDefaultEdgeBlendData();
    }

    var build = {
      enabled: !!ioEdgeBlendControls.enabled.checked,
      gamma: Number(ioEdgeBlendControls.gamma.number.value || ioEdgeBlendControls.gamma.range.value || 1.78),
      sides: {}
    };

    var keys = ['left', 'right', 'top', 'bottom'];
    for(var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var ctrl = ioEdgeBlendControls.sides[k];
      build.sides[k] = {
        enabled: !!ctrl.enabled.checked,
        width: Number(ctrl.widthNumber.value || ctrl.widthRange.value || 0),
        smooth: Number(ctrl.smoothNumber.value || ctrl.smoothRange.value || 0.55)
      };
    }

    return normalizeEdgeBlendData(build);
  };
  var ensureLayerEdgeOverlay = function(layer) {
    if(!layer || !layer.element) {
      return null;
    }
    if(layer.edgeBlendOverlay && layer.edgeBlendOverlay.parentNode) {
      return layer.edgeBlendOverlay;
    }

    var overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0px';
    overlay.style.left = '0px';
    overlay.style.width = layer.width + 'px';
    overlay.style.height = layer.height + 'px';
    overlay.style.margin = '0px';
    overlay.style.padding = '0px';
    overlay.style.pointerEvents = 'none';
    overlay.style.background = 'transparent';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    layer.edgeBlendOverlay = overlay;
    return overlay;
  };

  var removeLayerEdgeOverlay = function(layer) {
    if(!layer || !layer.edgeBlendOverlay) {
      return;
    }
    if(layer.edgeBlendOverlay.parentNode) {
      layer.edgeBlendOverlay.parentNode.removeChild(layer.edgeBlendOverlay);
    }
    layer.edgeBlendOverlay = null;
  };

  var applyEdgeBlendToLayer = function(layer) {
    if(!layer || !layer.element) {
      return;
    }

    var edge = normalizeEdgeBlendData(layer.edgeBlend);
    layer.edgeBlend = edge;

    var overlay = ensureLayerEdgeOverlay(layer);
    if(!overlay) {
      return;
    }

    if(!edge.enabled) {
      overlay.style.display = 'none';
      overlay.style.boxShadow = '';
      return;
    }
    overlay.style.display = 'block';

    var alpha = Math.max(0.05, Math.min(1, edge.gamma / 2));
    var shadows = [];
    var sideKeys = ['left', 'right', 'top', 'bottom'];

    for(var i = 0; i < sideKeys.length; i++) {
      var sideName = sideKeys[i];
      var side = edge.sides[sideName];
      if(!side.enabled || side.width <= 0) {
        continue;
      }

      var w = Math.max(0, Number(side.width || 0));
      var smooth = Math.max(0, Math.min(1, Number(side.smooth || 0)));
      var blur = Math.round(w * (0.2 + (1.8 * smooth)));
      var spread = -Math.max(1, Math.round(w * 0.9));
      var color = 'rgba(0,0,0,' + String(alpha) + ')';

      if(sideName === 'left') {
        shadows.push('inset ' + w + 'px 0px ' + blur + 'px ' + spread + 'px ' + color);
      } else if(sideName === 'right') {
        shadows.push('inset -' + w + 'px 0px ' + blur + 'px ' + spread + 'px ' + color);
      } else if(sideName === 'top') {
        shadows.push('inset 0px ' + w + 'px ' + blur + 'px ' + spread + 'px ' + color);
      } else if(sideName === 'bottom') {
        shadows.push('inset 0px -' + w + 'px ' + blur + 'px ' + spread + 'px ' + color);
      }
    }

    overlay.style.boxShadow = shadows.join(', ');
  };
  var applyEdgeBlendDraft = function() {
    if(!selectedLayer || !ioEdgeBlendControls) {
      return;
    }

    selectedLayer.edgeBlend = readEdgeBlendFromInputs();
    applyEdgeBlendToLayer(selectedLayer);

    if(autoSave) {
      saveSettings();
    }
    notifyChangeListener();
  };
  var applySliceDraft = function() {
    if(!selectedLayer || !ioSliceDraftRect) {
      return;
    }
    applySliceToLayer(selectedLayer, ioSliceDraftRect);
  };

  var applyLayerClip = function(layer) {
    if(!layer || !layer.element || !layer.slice || !layer.slice.sourceRect) {
      return;
    }

    var rect = layer.slice.sourceRect;
    var top = Math.max(0, Math.round(rect.y));
    var left = Math.max(0, Math.round(rect.x));
    var right = Math.max(0, Math.round(rect.x + rect.width));
    var bottom = Math.max(0, Math.round(rect.y + rect.height));

    var clipPathInset = 'inset(' + top + 'px ' + Math.max(0, layer.width - right) + 'px ' + Math.max(0, layer.height - bottom) + 'px ' + left + 'px)';
    layer.element.style.clipPath = clipPathInset;
    layer.element.style.webkitClipPath = clipPathInset;

    layer.element.style.clip = 'rect(' + top + 'px, ' + right + 'px, ' + bottom + 'px, ' + left + 'px)';
    layer.element.style.position = 'fixed';

    var overlay = ensureLayerEdgeOverlay(layer);
    if(overlay) {
      overlay.style.clipPath = clipPathInset;
      overlay.style.webkitClipPath = clipPathInset;
      overlay.style.clip = 'rect(' + top + 'px, ' + right + 'px, ' + bottom + 'px, ' + left + 'px)';
      overlay.style.position = 'fixed';
    }
  };

  var setSliceGeometry = function(layer, rect) {
    if(!layer) {
      return;
    }

    var x = Math.max(0, readNumber(rect.x, 0));
    var y = Math.max(0, readNumber(rect.y, 0));
    var w = Math.max(1, readNumber(rect.width, layer.width));
    var h = Math.max(1, readNumber(rect.height, layer.height));

    if(x + w > layer.width) {
      w = Math.max(1, layer.width - x);
    }
    if(y + h > layer.height) {
      h = Math.max(1, layer.height - y);
    }

    layer.slice = normalizeSliceData({
      id: (layer.slice && layer.slice.id) || 'slice-0',
      enabled: true,
      sourceRect: { x: x, y: y, width: w, height: h }
    }, layer.width, layer.height);

    layer.sourcePoints = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ];

    applyLayerClip(layer);
  };

  var applySliceToLayer = function(layer, rect) {
    if(!layer) {
      return;
    }

    setSliceGeometry(layer, rect);
    updateTransform();
    draw();
    refreshSliceInputs();
    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  };

  var resetSliceForSelectedLayer = function() {
    if(!selectedLayer) {
      return;
    }

    ioSliceDraftRect = {
      x: 0,
      y: 0,
      width: selectedLayer.width,
      height: selectedLayer.height
    };
    renderSliceDraftBox();
    applySliceDraft();
  };

  var cloneSourceMeta = function(meta) {
    if(!meta || typeof meta !== 'object') {
      return null;
    }
    var cloned = {};
    var keys = Object.keys(meta);
    for(var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if(key === 'file') {
        cloned.file = meta.file || null;
      } else {
        cloned[key] = meta[key];
      }
    }
    return cloned;
  };

  var inferLayerSourceMetaFromElement = function(element) {
    if(!element) {
      return null;
    }
    if(element.__maptasticSourceMeta) {
      return cloneSourceMeta(element.__maptasticSourceMeta);
    }

    var tag = String(element.tagName || '').toUpperCase();
    if(tag === 'VIDEO' || tag === 'IMG') {
      return {
        type: 'url',
        kind: tag.toLowerCase(),
        url: String(element.getAttribute('src') || element.src || '')
      };
    }
    if(tag === 'IFRAME') {
      if(element.srcdoc && element.srcdoc.length > 0) {
        return { type: 'srcdoc', kind: 'iframe', html: element.srcdoc };
      }
      return {
        type: 'url',
        kind: 'iframe',
        url: String(element.getAttribute('src') || element.src || '')
      };
    }
    return { type: 'dom', kind: tag.toLowerCase() || 'unknown' };
  };

  var setLayerSourceMeta = function(layer, meta) {
    if(!layer || !layer.element) {
      return;
    }
    var cloned = cloneSourceMeta(meta);
    layer.sourceMeta = cloned;
    layer.element.__maptasticSourceMeta = cloneSourceMeta(cloned);
  };

  var sanitizeExportName = function(name, fallbackBase) {
    var base = String(name || '').trim();
    if(base === '') {
      base = fallbackBase || 'asset';
    }
    base = base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    base = base.replace(/_+/g, '_');
    return base;
  };

  var splitFileName = function(name) {
    var safe = sanitizeExportName(name || '', 'asset');
    var idx = safe.lastIndexOf('.');
    if(idx <= 0 || idx === safe.length - 1) {
      return { base: safe, ext: '' };
    }
    return {
      base: safe.slice(0, idx),
      ext: safe.slice(idx)
    };
  };

  var uniqueExportName = function(name, used) {
    var parts = splitFileName(name);
    var attempt = parts.base + parts.ext;
    var n = 1;
    while(used[attempt]) {
      attempt = parts.base + '-' + String(n) + parts.ext;
      n++;
    }
    used[attempt] = true;
    return attempt;
  };

  var readFileAsDataUrl = function(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = function() { reject(new Error('Failed reading file: ' + String(file && file.name || 'unknown'))); };
      reader.readAsDataURL(file);
    });
  };

  var extensionFromMimeType = function(mimeType) {
    var mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
    var table = {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'text/html': '.html'
    };
    return table[mime] || '';
  };

  var guessFileNameFromUrl = function(url, fallbackBase, mimeType) {
    var fallback = sanitizeExportName(fallbackBase || 'downloaded-asset', 'downloaded-asset');
    var extFromMime = extensionFromMimeType(mimeType);
    try {
      var u = new URL(url, window.location.href);
      var pathName = decodeURIComponent(u.pathname || '');
      var parts = pathName.split('/');
      var last = parts.length > 0 ? parts[parts.length - 1] : '';
      var safe = sanitizeExportName(last, fallback);
      if(safe && safe !== '_') {
        if(safe.indexOf('.') > 0 || !extFromMime) {
          return safe;
        }
        return safe + extFromMime;
      }
    } catch(parseErr) {}

    if(extFromMime) {
      return fallback + extFromMime;
    }
    return fallback;
  };

  var downloadUrlToBlob = async function(url) {
    var response = await fetch(url, { mode: 'cors' });
    if(!response.ok) {
      throw new Error('HTTP ' + String(response.status));
    }
    var blob = await response.blob();
    var mime = String(response.headers.get('content-type') || blob.type || '');
    return { blob: blob, mimeType: mime };
  };

  var tryAttachDownloadedUrlSource = async function(descriptor, usedNames, filesToExport, warnings, downloadCache) {
    if(!descriptor || !descriptor.source || descriptor.source.mode !== 'url') {
      return;
    }
    var tag = String(descriptor.tag || '').toUpperCase();
    if(tag !== 'VIDEO' && tag !== 'IMG') {
      return;
    }

    var mediaUrl = String(descriptor.source.url || '').trim();
    if(mediaUrl === '') {
      return;
    }
    if(!(mediaUrl.indexOf('http://') === 0 || mediaUrl.indexOf('https://') === 0)) {
      return;
    }

    if(downloadCache[mediaUrl]) {
      descriptor.source = {
        mode: 'filePath',
        path: downloadCache[mediaUrl].name,
        fileName: downloadCache[mediaUrl].name,
        mimeType: downloadCache[mediaUrl].mimeType || ''
      };
      return;
    }

    try {
      var downloaded = await downloadUrlToBlob(mediaUrl);
      var guessedName = guessFileNameFromUrl(mediaUrl, descriptor.id || 'downloaded-media', downloaded.mimeType);
      var exportName = uniqueExportName(guessedName, usedNames);
      filesToExport.push({ name: exportName, file: downloaded.blob });
      descriptor.source = {
        mode: 'filePath',
        path: exportName,
        fileName: exportName,
        mimeType: downloaded.mimeType || ''
      };
      downloadCache[mediaUrl] = { name: exportName, mimeType: downloaded.mimeType || '' };
    } catch(downloadErr) {
      warnings.push('Downloader gagal untuk ' + descriptor.id + ': ' + mediaUrl + ' (' + String(downloadErr && downloadErr.message || downloadErr) + ')');
    }
  };
  var buildRuntimeScriptFallback = function() {
    var chunks = [];
    if(typeof solve === 'function') {
      chunks.push('var solve = ' + solve.toString() + ';');
    }
    if(typeof Maptastic === 'function') {
      chunks.push('var Maptastic = ' + Maptastic.toString() + ';');
    }
    return chunks.join('\n');
  };
  var getRuntimeScriptText = async function() {
    if(runtimeScriptTextCache) {
      return runtimeScriptTextCache;
    }

    var scripts = document.getElementsByTagName('script');
    for(var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if(src.indexOf('maptastic') < 0) {
        continue;
      }
      try {
        var url = new URL(src, window.location.href).href;
        var response = await fetch(url, { cache: 'no-store' });
        if(response.ok) {
          runtimeScriptTextCache = await response.text();
          if(runtimeScriptTextCache) {
            return runtimeScriptTextCache;
          }
        }
      } catch(fetchErr) {}
    }

    var fallbackRuntime = buildRuntimeScriptFallback();
    if(fallbackRuntime) {
      runtimeScriptTextCache = fallbackRuntime;
      return runtimeScriptTextCache;
    }

    throw new Error('Tidak bisa membaca script runtime maptastic.js untuk export.');
  };

  var buildLayerExportDescriptor = async function(layer, mode, usedNames, filesToExport, warnings) {
    var element = layer.element;
    var tag = String(element.tagName || '').toUpperCase();
    var sourceMeta = layer.sourceMeta || inferLayerSourceMetaFromElement(element);

    var descriptor = {
      id: String(element.id || generateLayerId('layer')),
      tag: tag,
      width: Number(layer.width || element.clientWidth || 640),
      height: Number(layer.height || element.clientHeight || 360),
      objectFit: String(element.style.objectFit || ''),
      background: String(element.style.background || ''),
      controls: !!element.controls,
      autoplay: !!element.autoplay,
      loop: !!element.loop,
      muted: !!element.muted,
      playsInline: !!element.playsInline,
      source: { mode: 'none' }
    };

    if(sourceMeta && sourceMeta.type === 'file' && sourceMeta.file) {
      var sourceFile = sourceMeta.file;
      var exportName = uniqueExportName(sourceMeta.name || sourceFile.name || (descriptor.id + '.bin'), usedNames);
      if(mode === 'inline') {
        descriptor.source = {
          mode: 'dataUrl',
          dataUrl: await readFileAsDataUrl(sourceFile),
          fileName: exportName,
          mimeType: sourceMeta.mime || sourceFile.type || ''
        };
      } else {
        descriptor.source = {
          mode: 'filePath',
          path: exportName,
          fileName: exportName,
          mimeType: sourceMeta.mime || sourceFile.type || ''
        };
        filesToExport.push({ name: exportName, file: sourceFile });
      }
      return descriptor;
    }

    if(tag === 'IFRAME') {
      if(sourceMeta && sourceMeta.type === 'srcdoc' && sourceMeta.html != null) {
        descriptor.source = { mode: 'srcdoc', html: String(sourceMeta.html) };
      } else if(element.srcdoc && element.srcdoc.length > 0) {
        descriptor.source = { mode: 'srcdoc', html: String(element.srcdoc) };
      } else {
        var iframeUrl = (sourceMeta && sourceMeta.url) ? sourceMeta.url : (element.getAttribute('src') || element.src || '');
        descriptor.source = { mode: 'url', url: String(iframeUrl || '') };
      }
      return descriptor;
    }

    if(tag === 'VIDEO' || tag === 'IMG') {
      var directUrl = '';
      if(sourceMeta && sourceMeta.type === 'url' && sourceMeta.url) {
        directUrl = sourceMeta.url;
      } else {
        directUrl = String(element.getAttribute('src') || element.src || '');
      }
      descriptor.source = { mode: 'url', url: String(directUrl || '') };
      if(directUrl.indexOf('blob:') === 0) {
        warnings.push('Layer ' + descriptor.id + ' masih menggunakan blob URL tanpa file asli; media mungkin tidak ikut saat dibuka ulang.');
      }
      return descriptor;
    }

    descriptor.source = { mode: 'none' };
    return descriptor;
  };

  var buildProjectExportData = async function(mode) {
    var layoutData = getLayout();
    var usedNames = {};
    var filesToExport = [];
    var warnings = [];
    var layerDescriptors = [];
    var downloadCache = {};

    for(var i = 0; i < layers.length; i++) {
      layerDescriptors.push(await buildLayerExportDescriptor(layers[i], mode, usedNames, filesToExport, warnings));
    }

    if(mode === 'folder-download') {
      for(var n = 0; n < layerDescriptors.length; n++) {
        await tryAttachDownloadedUrlSource(layerDescriptors[n], usedNames, filesToExport, warnings, downloadCache);
      }
    }

    return {
      layout: layoutData,
      layers: layerDescriptors,
      files: filesToExport,
      warnings: warnings
    };
  };

  var buildProjectHtmlDocument = function(exportData, runtimeScriptText) {
    var payloadText = JSON.stringify({ layout: exportData.layout, layers: exportData.layers }).split('</').join('<\\/');
    var payloadLiteral = JSON.stringify(payloadText);
    var safeRuntimeScript = String(runtimeScriptText || '').split('</script>').join('<\\/script>');
    return [
      '<!doctype html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <title>Maptastic Export</title>',
      '  <style>',
      '    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#000; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <script>',
      safeRuntimeScript,
      '  </script>',
      '  <script>',
      '  (function(){',
      '    var payload = JSON.parse(' + payloadLiteral + ');',
      '    var layers = payload.layers || [];',
      '    for(var i = 0; i < layers.length; i++) {',
      '      var desc = layers[i];',
      '      var tag = String(desc.tag || "DIV").toLowerCase();',
      '      var el = document.createElement(tag);',
      '      el.id = desc.id;',
      '      el.style.position = "fixed";',
      '      el.style.left = "0px";',
      '      el.style.top = "0px";',
      '      el.style.margin = "0";',
      '      el.style.padding = "0";',
      '      el.style.width = String(desc.width || 640) + "px";',
      '      el.style.height = String(desc.height || 360) + "px";',
      '      if(desc.objectFit) { el.style.objectFit = desc.objectFit; }',
      '      if(desc.background) { el.style.background = desc.background; }',
      '      var source = desc.source || { mode: "none" };',
      '      if(tag === "video") {',
      '        el.autoplay = !!desc.autoplay;',
      '        el.loop = !!desc.loop;',
      '        el.muted = !!desc.muted;',
      '        el.controls = !!desc.controls;',
      '        el.playsInline = !!desc.playsInline;',
      '      }',
      '      if(source.mode === "dataUrl") {',
      '        if(tag === "iframe") { el.src = source.dataUrl; } else { el.src = source.dataUrl; }',
      '      } else if(source.mode === "filePath") {',
      '        el.src = source.path;',
      '      } else if(source.mode === "url") {',
      '        el.src = source.url || "";',
      '      } else if(source.mode === "srcdoc") {',
      '        el.setAttribute("sandbox", "allow-scripts allow-same-origin");',
      '        el.srcdoc = source.html || "";',
      '      }',
      '      if(tag === "iframe") {',
      '        el.setAttribute("frameborder", "0");',
      '      }',
      '      document.body.appendChild(el);',
      '    }',
      '    var ids = [];',
      '    for(var n = 0; n < layers.length; n++) { ids.push(layers[n].id); }',
            '    var m = Maptastic({ autoSave:false, autoLoad:false, layers: ids });',
      '    var applyLayout = function(){',
      '      m.setLayout(payload.layout || []);',
      '      m.setConfigEnabled(false);',
      '    };',
      '    applyLayout();',
      '    window.__maptasticExport = m;',
      '    for(var r = 0; r < layers.length; r++) {',
      '      (function(desc){',
      '        var el = document.getElementById(desc.id);',
      '        if(!el) { return; }',
      '        var tagName = String(desc.tag || "").toUpperCase();',
      '        if(tagName === "VIDEO") {',
      '          var relayout = function(){ applyLayout(); };',
      '          el.addEventListener("loadedmetadata", relayout);',
      '          el.addEventListener("canplay", relayout);',
      '          var playPromise = null;',
      '          try { playPromise = el.play(); } catch (e) {}',
      '          if(playPromise && playPromise.catch) { playPromise.catch(function(){}); }',
      '        } else if(tagName === "IMG") {',
      '          el.addEventListener("load", function(){ applyLayout(); });',
      '        }',
      '      })(layers[r]);',
      '    }',
      '    setTimeout(applyLayout, 0);',
      '    setTimeout(applyLayout, 100);',
      '    setTimeout(applyLayout, 400);',
      '  })();',
      '  </script>',
      '</body>',
      '</html>'
    ].join('\n');
  };

  var downloadTextFile = function(fileName, textContent) {
    var blob = new Blob([textContent], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  };

  var saveProjectAsHtml = async function() {
    try {
      var runtimeScriptText = await getRuntimeScriptText();
      var exportData = await buildProjectExportData('inline');
      var html = buildProjectHtmlDocument(exportData, runtimeScriptText);

      if(window.showSaveFilePicker) {
        var fileHandle = await window.showSaveFilePicker({
          suggestedName: 'maptastic-project.html',
          types: [{ description: 'HTML File', accept: { 'text/html': ['.html'] } }]
        });
        var writable = await fileHandle.createWritable();
        await writable.write(html);
        await writable.close();
      } else {
        downloadTextFile('maptastic-project.html', html);
      }

      if(exportData.warnings && exportData.warnings.length > 0) {
        alert('Save As selesai dengan catatan:\n- ' + exportData.warnings.join('\n- '));
      }
    } catch(err) {
      alert('Save As gagal: ' + String(err && err.message || err));
    }
  };

  var exportProjectFolder = async function(withDownloader) {
    if(!window.showDirectoryPicker) {
      alert('Browser belum mendukung export folder. Gunakan Chrome/Edge terbaru.');
      return;
    }

    try {
      var runtimeScriptText = await getRuntimeScriptText();
      var exportMode = withDownloader ? 'folder-download' : 'folder';
      var exportData = await buildProjectExportData(exportMode);
      var html = buildProjectHtmlDocument(exportData, runtimeScriptText);

      var dir = await window.showDirectoryPicker({ mode: 'readwrite' });

      var indexHandle = await dir.getFileHandle('index.html', { create: true });
      var indexWritable = await indexHandle.createWritable();
      await indexWritable.write(html);
      await indexWritable.close();

      for(var i = 0; i < exportData.files.length; i++) {
        var item = exportData.files[i];
        var mediaHandle = await dir.getFileHandle(item.name, { create: true });
        var mediaWritable = await mediaHandle.createWritable();
        await mediaWritable.write(item.file);
        await mediaWritable.close();
      }

      if(exportData.warnings && exportData.warnings.length > 0) {
        alert('Export selesai dengan catatan:\n- ' + exportData.warnings.join('\n- '));
      }
    } catch(err) {
      alert('Export folder gagal: ' + String(err && err.message || err));
    }
  };
  var addFileLayer = function(file) {
    if(!file) {
      return;
    }

    var mime = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();

    if(mime.indexOf('video/') === 0) {
      addVideoLayer(file);
      return;
    }

    if(mime.indexOf('image/') === 0 || /\.gif$/i.test(name)) {
      addImageLayer(file);
      return;
    }

    if(mime.indexOf('text/html') === 0 || /\.(html|htm)$/i.test(name)) {
      addHtmlLayer(file);
      return;
    }

    alert('Format file belum didukung. Gunakan video, image/gif, atau html.');
  };

  var finishLayerCreation = function(element, sourceMeta) {
    var createdLayer = addLayer(element);
    if(createdLayer && sourceMeta) {
      setLayerSourceMeta(createdLayer, sourceMeta);
    }
    selectLayerByElement(element);
    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  };

  var addVideoLayer = function(file) {
    var video = document.createElement('video');
    video.id = generateLayerId('video-source');
    video.src = URL.createObjectURL(file);
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.controls = true;
    video.playsInline = true;
    video.style.width = '480px';
    video.style.height = '270px';
    video.style.objectFit = 'contain';
    video.style.background = 'transparent';
    video.style.left = Math.round((window.innerWidth - 480) / 2) + 'px';
    video.style.top = Math.round((window.innerHeight - 270) / 2) + 'px';
    document.body.appendChild(video);
    finishLayerCreation(video, { type: 'file', kind: 'video', file: file, name: file.name, mime: file.type });
  };

  var addImageLayer = function(file) {
    var image = document.createElement('img');
    image.id = generateLayerId('image-source');
    image.src = URL.createObjectURL(file);
    image.style.width = '480px';
    image.style.height = '270px';
    image.style.objectFit = 'contain';
    image.style.background = 'transparent';
    image.style.left = Math.round((window.innerWidth - 480) / 2) + 'px';
    image.style.top = Math.round((window.innerHeight - 270) / 2) + 'px';
    document.body.appendChild(image);
    finishLayerCreation(image, { type: 'file', kind: 'image', file: file, name: file.name, mime: file.type });
  };

  var addHtmlLayer = function(file) {
    var reader = new FileReader();
    reader.onload = function() {
      var iframe = document.createElement('iframe');
      iframe.id = generateLayerId('html-source');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.srcdoc = String(reader.result || '');
      iframe.style.width = '640px';
      iframe.style.height = '360px';
      iframe.style.background = 'white';
      iframe.style.left = Math.round((window.innerWidth - 640) / 2) + 'px';
      iframe.style.top = Math.round((window.innerHeight - 360) / 2) + 'px';
      document.body.appendChild(iframe);
      finishLayerCreation(iframe, { type: 'file', kind: 'html', file: file, name: file.name, mime: file.type, html: String(reader.result || '') });
    };
    reader.onerror = function() {
      alert('Gagal membaca file HTML.');
    };
    reader.readAsText(file);
  };

  var normalizeWebUrl = function(url) {
    if(!url) {
      return '';
    }
    var trimmed = url.trim();
    if(trimmed === '') {
      return '';
    }
    if(trimmed.indexOf('http://') !== 0 && trimmed.indexOf('https://') !== 0) {
      trimmed = 'https://' + trimmed;
    }
    return trimmed;
  };

  var addWebLayer = function(url) {
    var targetUrl = normalizeWebUrl(url);
    if(!targetUrl) {
      return;
    }

    var iframe = document.createElement('iframe');
    iframe.id = generateLayerId('web-source');
    iframe.src = targetUrl;
    iframe.setAttribute('frameborder', '0');
    iframe.style.width = '640px';
    iframe.style.height = '360px';
    iframe.style.background = 'white';
    iframe.style.left = Math.round((window.innerWidth - 640) / 2) + 'px';
    iframe.style.top = Math.round((window.innerHeight - 360) / 2) + 'px';
    document.body.appendChild(iframe);

    var webLayer = addLayer(iframe);
    if(webLayer) {
      setLayerSourceMeta(webLayer, { type: 'url', kind: 'iframe', url: targetUrl });
    }
    selectLayerByElement(iframe);
    ioUrlInput.value = '';
    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  };


  var deleteSelectedLayer = function() {
    if(!selectedLayer) {
      return;
    }

    for(var i = 0; i < layers.length; i++) {
      if(layers[i] === selectedLayer) {
        removeLayerEdgeOverlay(selectedLayer);
        removeLayerTriangleCanvas(selectedLayer);
        if(selectedLayer.element && selectedLayer.element.parentNode) {
          selectedLayer.element.parentNode.removeChild(selectedLayer.element);
        }
        layers.splice(i, 1);
        break;
      }
    }

    selectedLayer = null;
    clearMeshSelection();
    refreshSliceInputs();
    selectedPoint = null;
    hoveringLayer = null;
    hoveringPoint = null;

    updateTransform();
    draw();
    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  };

  var duplicateSelectedLayer = function() {
    if(!selectedLayer) {
      return;
    }

    var sourceElement = selectedLayer.element;
    var cloneElement = sourceElement.cloneNode(true);
    cloneElement.id = generateLayerId(sourceElement.id || sourceElement.tagName.toLowerCase() + '-layer');
    document.body.appendChild(cloneElement);

    var clonedTargetPoints = clonePoints(selectedLayer.targetPoints);
    for(var p = 0; p < clonedTargetPoints.length; p++) {
      clonedTargetPoints[p][0] += 24;
      clonedTargetPoints[p][1] += 24;
    }

    var newLayer = addLayer(cloneElement, clonedTargetPoints);
    if(newLayer) {
      newLayer.sourcePoints = clonePoints(selectedLayer.sourcePoints);
      newLayer.slice = cloneSliceData(selectedLayer.slice, selectedLayer.width, selectedLayer.height);
      newLayer.mesh = cloneMeshData(selectedLayer.mesh, selectedLayer.width, selectedLayer.height);
      newLayer.schedule = cloneScheduleData(selectedLayer.schedule);
      newLayer.edgeBlend = cloneEdgeBlendData(selectedLayer.edgeBlend);
      setLayerSourceMeta(newLayer, cloneSourceMeta(selectedLayer.sourceMeta));
      applyEdgeBlendToLayer(newLayer);
      updateTransform();
      selectedLayer = newLayer;
      selectedPoint = null;
      draw();
      if(autoSave){
        saveSettings();
      }
      notifyChangeListener();
    }
  };
	var rotateLayer = function(layer, angle) {
		var s = Math.sin(angle);
		var c = Math.cos(angle);

		var centerPoint = [0, 0];
    for(var p = 0; p < layer.targetPoints.length; p++) {
      centerPoint[0] += layer.targetPoints[p][0];
      centerPoint[1] += layer.targetPoints[p][1];
    }

    centerPoint[0] /= 4;
    centerPoint[1] /= 4;

    for(var p = 0; p < layer.targetPoints.length; p++) {
    	var px = layer.targetPoints[p][0] - centerPoint[0];
    	var py = layer.targetPoints[p][1] - centerPoint[1];

			layer.targetPoints[p][0] = (px * c) - (py * s) + centerPoint[0];
    	layer.targetPoints[p][1] = (px * s) + (py * c) + centerPoint[1];
    }
	}

	var scaleLayer = function(layer, scale) {

		var centerPoint = [0, 0];
    for(var p = 0; p < layer.targetPoints.length; p++) {
      centerPoint[0] += layer.targetPoints[p][0];
      centerPoint[1] += layer.targetPoints[p][1];
    }

    centerPoint[0] /= 4;
    centerPoint[1] /= 4;

    for(var p = 0; p < layer.targetPoints.length; p++) {
    	var px = layer.targetPoints[p][0] - centerPoint[0];
    	var py = layer.targetPoints[p][1] - centerPoint[1];

			layer.targetPoints[p][0] = (px * scale) + centerPoint[0];
    	layer.targetPoints[p][1] = (py * scale) + centerPoint[1];
    }
	}

	var keyDown = function(event) {
  if(isToggleEditShortcut(event)) {
    return;
  }
  if(!configActive){
    return;
  }

  if(isKeyboardTextEntryTarget(event.target) || isKeyboardTextEntryTarget(document.activeElement)) {
    return;
  }

  var key = event.keyCode;
  var increment = event.shiftKey ? 10 : 1;
  var dirty = false;
  var delta = [0, 0];

  if(key >= 37 && key <= 40) {
    event.preventDefault();
    event.stopPropagation();
  }

  switch(key){
    case 32:
      break;
    case 37:
      delta[0] -= increment;
      break;
    case 38:
      delta[1] -= increment;
      break;
    case 39:
      delta[0] += increment;
      break;
    case 40:
      delta[1] += increment;
      break;
    case 67:
      showCrosshairs = !showCrosshairs;
      dirty = true;
      break;
    case 83:
      if(!isLayerSoloed) {
        if(selectedLayer != null) {
          for(var s1 = 0; s1 < layers.length; s1++) {
            layers[s1].visible = false;
          }
          selectedLayer.visible = true;
          dirty = true;
          isLayerSoloed = true;
        }
      } else {
        for(var s2 = 0; s2 < layers.length; s2++) {
          layers[s2].visible = true;
        }
        isLayerSoloed = false;
        dirty = true;
      }
      break;
    case 66:
      showScreenBounds = !showScreenBounds;
      draw();
      break;
    case 72:
      if(selectedLayer) {
        swapLayerPoints(selectedLayer.sourcePoints, 0, 1);
        swapLayerPoints(selectedLayer.sourcePoints, 3, 2);
        updateTransform();
        draw();
      }
      break;
    case 86:
      if(selectedLayer) {
        swapLayerPoints(selectedLayer.sourcePoints, 0, 3);
        swapLayerPoints(selectedLayer.sourcePoints, 1, 2);
        updateTransform();
        draw();
      }
      break;
    case 82:
      if(selectedLayer) {
        rotateLayer(selectedLayer, Math.PI / 2);
        updateTransform();
        draw();
      }
      break;
  }

  if(!showScreenBounds) {
    if(selectedPoint) {
      if(selectedLayer && selectedMeshPoints.length > 0 && hasPointReference(selectedMeshPoints, selectedPoint)) {
        for(var sm = 0; sm < selectedMeshPoints.length; sm++) {
          selectedMeshPoints[sm][0] += delta[0];
          selectedMeshPoints[sm][1] += delta[1];
        }
      } else {
        selectedPoint[0] += delta[0];
        selectedPoint[1] += delta[1];
      }
      if(selectedLayer && hasPointReference(selectedLayer.targetPoints, selectedPoint)) {
        rebuildLayerMeshFromTarget(selectedLayer, selectedLayer.mesh.columns, selectedLayer.mesh.rows);
      }
      dirty = true;
    } else if(selectedLayer) {
      if(event.altKey == true) {
        rotateLayer(selectedLayer, delta[0] * 0.01);
        scaleLayer(selectedLayer, (delta[1] * -0.005) + 1.0);
        rebuildLayerMeshFromTarget(selectedLayer, selectedLayer.mesh.columns, selectedLayer.mesh.rows);
      } else {
        for(var i = 0; i < selectedLayer.targetPoints.length; i++) {
          selectedLayer.targetPoints[i][0] += delta[0];
          selectedLayer.targetPoints[i][1] += delta[1];
        }
        if(selectedLayer.mesh && selectedLayer.mesh.points) {
          for(var mp = 0; mp < selectedLayer.mesh.points.length; mp++) {
            selectedLayer.mesh.points[mp][0] += delta[0];
            selectedLayer.mesh.points[mp][1] += delta[1];
          }
        }
      }
      dirty = true;
    }
  }

  if(dirty){
    updateTransform();
    draw();
    if(autoSave){
      saveSettings();
    }
    notifyChangeListener();
  }
};

	var mouseMove = function(event) {
	  if(!configActive){
    return;
  }

  if(uiControlDragActive || isFormControlTarget(event.target)) {
    return;
  }

  event.preventDefault();

	  mouseDelta[0] = event.clientX - mousePosition[0];
	  mouseDelta[1] = event.clientY - mousePosition[1];

	  mousePosition[0] = event.clientX;
	  mousePosition[1] = event.clientY;

	  if(dragging) {

	    var scale = event.shiftKey ? 0.1 : 1;
	    
	    if(selectedPoint) {
      if(selectedLayer && selectedMeshPoints.length > 0 && hasPointReference(selectedMeshPoints, selectedPoint)) {
        for(var smm = 0; smm < selectedMeshPoints.length; smm++) {
          selectedMeshPoints[smm][0] += mouseDelta[0] * scale;
          selectedMeshPoints[smm][1] += mouseDelta[1] * scale;
        }
      } else {
        selectedPoint[0] += mouseDelta[0] * scale;
        selectedPoint[1] += mouseDelta[1] * scale;
      }
        if(selectedLayer && hasPointReference(selectedLayer.targetPoints, selectedPoint)) {
          rebuildLayerMeshFromTarget(selectedLayer, selectedLayer.mesh.columns, selectedLayer.mesh.rows);
        }
	    } else if(selectedLayer) {
	      
	      if(event.altKey == true){
		      rotateLayer(selectedLayer,  mouseDelta[0] * (0.01 * scale));
		      scaleLayer(selectedLayer,  (mouseDelta[1] * (-0.005 * scale)) + 1.0);
          rebuildLayerMeshFromTarget(selectedLayer, selectedLayer.mesh.columns, selectedLayer.mesh.rows);
	    	} else {
		    for(var i = 0; i < selectedLayer.targetPoints.length; i++){
		        selectedLayer.targetPoints[i][0] += mouseDelta[0] * scale;
		        selectedLayer.targetPoints[i][1] += mouseDelta[1] * scale;
		      }	
          if(selectedLayer.mesh && selectedLayer.mesh.points) {
            for(var mp2 = 0; mp2 < selectedLayer.mesh.points.length; mp2++) {
              selectedLayer.mesh.points[mp2][0] += mouseDelta[0] * scale;
              selectedLayer.mesh.points[mp2][1] += mouseDelta[1] * scale;
            }
          }
	    	}
	    }

	    updateTransform();
      if(autoSave){
        saveSettings();
      }
	    draw();
      notifyChangeListener();

	  } else {
	    canvas.style.cursor = 'default';
	    var mouseX = event.clientX;
	    var mouseY = event.clientY;
	    
	    var previousState = (hoveringPoint != null);
	    var previousLayer = (hoveringLayer != null);

	    hoveringPoint = null;

      if(selectedLayer && selectedLayer.visible) {
        ensureLayerMesh(selectedLayer);
        hoveringPoint = findNearestPoint(selectedLayer.mesh ? selectedLayer.mesh.points : null, mouseX, mouseY, selectionRadius + 6);
        if(!hoveringPoint) {
          hoveringPoint = findNearestPoint(selectedLayer.targetPoints, mouseX, mouseY, selectionRadius);
        }
      }

      if(!hoveringPoint) {
	      for(var i2 = 0; i2 < layers.length; i2++) {
	        var layer = layers[i2];
	        if(!layer.visible || layer === selectedLayer) {
            continue;
          }
          var cornerHover = findNearestPoint(layer.targetPoints, mouseX, mouseY, selectionRadius);
          if(cornerHover) {
            hoveringPoint = cornerHover;
            break;
          }
	      }
      }

      if(hoveringPoint) {
        canvas.style.cursor = 'pointer';
      }

	    hoveringLayer = null;
	    for(var i3 = 0; i3 < layers.length; i3++) {
	      if(layers[i3].visible && pointInLayer(mousePosition, layers[i3])){
	        hoveringLayer = layers[i3];
	        break;
	      }
	    }

	    if( showCrosshairs || 
	        (previousState != (hoveringPoint != null)) || 
	        (previousLayer != (hoveringLayer != null))
	      ) {
	      draw();
	    }
	  }
};

	var mouseUp = function(event) {
	  if(!configActive){
	    return;
	  }
	  event.preventDefault();
	  
	  dragging = false;
	};

var mouseDown = function(event) {
  if(!configActive || showScreenBounds) {
    return;
  }
  if(ioPanel && ioPanel.contains(event.target)) {
    dragging = false;
    return;
  }
  if(ioButton && ioButton.contains(event.target)) {
    dragging = false;
    return;
  }
  if(ioSlicePopup && ioSlicePopup.contains(event.target)) {
    dragging = false;
    return;
  }
  if(ioSchedulePopup && ioSchedulePopup.contains(event.target)) {
    dragging = false;
    return;
  }
  event.preventDefault();

  hoveringPoint = null;

  var mouseX = event.clientX;
  var mouseY = event.clientY;
  mousePosition[0] = mouseX;
  mousePosition[1] = mouseY;

  var hitLayer = null;
  for(var hl = layers.length - 1; hl >= 0; hl--) {
    if(layers[hl].visible && pointInLayer([mouseX, mouseY], layers[hl])) {
      hitLayer = layers[hl];
      break;
    }
  }
  hoveringLayer = hitLayer;

  if(hitLayer) {
    selectedLayer = hitLayer;
    dragging = true;
  } else {
    selectedLayer = null;
    clearMeshSelection();
    dragging = false;
  }

  selectedPoint = null;

  mouseDownPoint[0] = mouseX;
  mouseDownPoint[1] = mouseY;

  if(selectedLayer) {
    ensureLayerMesh(selectedLayer);
    var meshHitNow = findNearestPoint(selectedLayer.mesh ? selectedLayer.mesh.points : null, mouseX, mouseY, selectionRadius + 6);
    if(meshHitNow) {
      selectMeshPoint(selectedLayer, meshHitNow, event.shiftKey === true);
      if(selectedMeshPoints.length > 0) {
        selectedPoint = selectedMeshPoints[selectedMeshPoints.length - 1];
        dragging = true;
        dragOffset[0] = event.clientX - selectedPoint[0];
        dragOffset[1] = event.clientY - selectedPoint[1];
      } else {
        selectedPoint = null;
        dragging = false;
      }
      refreshSliceInputs();
      refreshSubdivisionInputs();
      refreshEdgeBlendInputs();
      draw();
      return false;
    }
  }

  clearMeshSelection();

  if(selectedLayer) {
    var selectedCornerHit = findNearestPoint(selectedLayer.targetPoints, mouseX, mouseY, selectionRadius);
    if(selectedCornerHit) {
      selectedPoint = selectedCornerHit;
      dragging = true;
      dragOffset[0] = event.clientX - selectedCornerHit[0];
      dragOffset[1] = event.clientY - selectedCornerHit[1];
      refreshSliceInputs();
      refreshSubdivisionInputs();
      refreshEdgeBlendInputs();
      draw();
      return false;
    }
  }

  for(var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if(!layer.visible || layer === selectedLayer) {
      continue;
    }
    var cornerHit = findNearestPoint(layer.targetPoints, mouseX, mouseY, selectionRadius);
    if(cornerHit) {
      selectedLayer = layer;
      selectedPoint = cornerHit;
      dragging = true;
      dragOffset[0] = event.clientX - cornerHit[0];
      dragOffset[1] = event.clientY - cornerHit[1];
      break;
    }
  }

  refreshSliceInputs();
  refreshSubdivisionInputs();
  refreshEdgeBlendInputs();
  draw();
  return false;
};

var addLayer = function(target, targetPoints, sliceData, meshData, scheduleData, edgeBlendData) {

	  var element;

	  if(typeof(target) == 'string') {
	    element = document.getElementById(target);
	    if(!element) {
	      throw("Maptastic: No element found with id: " + target);
	    }
	  } else if (target instanceof HTMLElement) {
	    element = target;
	  }
    if(!element) {
      throw("Maptastic: Invalid layer target.");
    }

    for(var n = 0; n < layers.length; n++){
      if(layers[n].element.id == element.id) {
        if(targetPoints && targetPoints.length === 4) {
          layers[n].targetPoints = clonePoints(targetPoints);
        }
        if(sliceData) {
          layers[n].slice = normalizeSliceData(sliceData, layers[n].width, layers[n].height);
        }
        if(meshData) {
          layers[n].mesh = normalizeMeshData(meshData, layers[n].width, layers[n].height);
        }
        if(scheduleData) {
          layers[n].schedule = normalizeScheduleData(scheduleData);
        }
        if(edgeBlendData) {
          layers[n].edgeBlend = normalizeEdgeBlendData(edgeBlendData);
        }
        if(element.__maptasticSourceMeta) {
          layers[n].sourceMeta = cloneSourceMeta(element.__maptasticSourceMeta);
        }
        if(layers[n].slice) {
          setSliceGeometry(layers[n], layers[n].slice.sourceRect);
            ensureLayerMesh(layers[n]);
        }
        updateTransform();
        draw();
        return layers[n];
      }
    }

	  var offsetX = element.offsetLeft;
	  var offsetY = element.offsetTop;

	  element.style.position = 'fixed';
	  element.style.display = 'block';
	  element.style.top = '0px';
	  element.style.left = '0px';
	  element.style.padding = '0px';
	  element.style.margin = '0px';

	  var layer = {
	  	'visible' : true,
	    'element' : element,
	    'width' : element.clientWidth,
	    'height' : element.clientHeight,
	    'sourcePoints' : [],
	    'targetPoints' : [],
    'slice' : null,
    'mesh' : null,
    'schedule' : createDefaultScheduleData(),
    'edgeBlend' : createDefaultEdgeBlendData(),
    'edgeBlendOverlay' : null,
    'triangleCanvas' : null,
    'triangleContext' : null,
    'triangleWarpActive' : false,
    'sourceMeta' : inferLayerSourceMetaFromElement(element)
	  };
	  layer.sourcePoints.push( [0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]);
	  
	  if(targetPoints) {
	    layer.targetPoints = clonePoints(targetPoints);
	  } else {
	    layer.targetPoints.push( [0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]);
	    for(var i = 0; i < layer.targetPoints.length; i++){
	      layer.targetPoints[i][0] += offsetX;
	      layer.targetPoints[i][1] += offsetY;
	    }
	  }
	  
    layer.slice = normalizeSliceData(sliceData, layer.width, layer.height);
    layer.mesh = normalizeMeshData(meshData, layer.width, layer.height);
    layer.schedule = normalizeScheduleData(scheduleData);
    layer.edgeBlend = normalizeEdgeBlendData(edgeBlendData);
    setSliceGeometry(layer, layer.slice.sourceRect);
    ensureLayerMesh(layer);
    applyEdgeBlendToLayer(layer);
	  layers.push(layer);

	  updateTransform();
    draw();
    return layer;
	};

  var saveSettings = function() {
    localStorage.setItem(localStorageKey, JSON.stringify(getLayout(layers)));
  };

  var loadSettings = function() {
    if(localStorage.getItem(localStorageKey)){
      var data = JSON.parse(localStorage.getItem(localStorageKey));
      
      for(var i = 0; i < data.length; i++) {
        for(var n = 0; n < layers.length; n++){
          if(layers[n].element.id == data[i].id) {
            layers[n].targetPoints = clonePoints(data[i].targetPoints);
            layers[n].slice = normalizeSliceData(data[i].slice, layers[n].width, layers[n].height);
            layers[n].mesh = normalizeMeshData(data[i].mesh, layers[n].width, layers[n].height);
            layers[n].schedule = normalizeScheduleData(data[i].schedule);
            layers[n].edgeBlend = normalizeEdgeBlendData(data[i].edgeBlend);
            setSliceGeometry(layers[n], layers[n].slice.sourceRect);
            ensureLayerMesh(layers[n]);
            applyEdgeBlendToLayer(layers[n]);
          }
        }
      }
      updateTransform();
    }
  }
  var updateTransform = function() {
    var transform = ["", "-webkit-", "-moz-", "-ms-", "-o-"].reduce(function(p, v) { return v + "transform" in document.body.style ? v : p; }) + "transform";
    for(var l = 0; l < layers.length; l++) {
      var layer = layers[l];
      var matrix = null;
      ensureLayerMesh(layer);
      if(layer.mesh && layer.mesh.points && (layer.mesh.columns > 1 || layer.mesh.rows > 1)) {
        matrix = solveHomographyLeastSquares(getLayerMeshSourcePoints(layer), layer.mesh.points);
      }

      if(!matrix) {
        var targetQuad = layer.targetPoints;
        var a = [];
        var b = [];
        for(var i = 0, n = layer.sourcePoints.length; i < n; ++i) {
          var s = layer.sourcePoints[i];
          var t = targetQuad[i];
          a.push([s[0], s[1], 1, 0, 0, 0, -s[0] * t[0], -s[1] * t[0]]);
          b.push(t[0]);
          a.push([0, 0, 0, s[0], s[1], 1, -s[0] * t[1], -s[1] * t[1]]);
          b.push(t[1]);
        }

        var X = null;
        try {
          X = solve(a, b, true);
        } catch(e) {
          X = null;
        }
        if(!X || X.length < 8) {
          continue;
        }

        matrix = [
          X[0], X[3], 0, X[6],
          X[1], X[4], 0, X[7],
          0,    0,   1, 0,
          X[2], X[5], 0, 1
        ];
      }
      layer.element.style[transform] = "matrix3d(" + matrix.join(',') + ")";
      layer.element.style[transform + "-origin"] = "0px 0px 0px";
      var overlay = ensureLayerEdgeOverlay(layer);
      if(overlay) {
        overlay.style[transform] = "matrix3d(" + matrix.join(',') + ")";
        overlay.style[transform + "-origin"] = "0px 0px 0px";
      }
      applyEdgeBlendToLayer(layer);
    }
  };

	var setConfigEnabled = function(enabled){
	  configActive = enabled;
	  canvas.style.display = enabled ? 'block' : 'none';
    if(ioButton) {
      ioButton.style.display = enabled ? 'block' : 'none';
    }
    if(ioPanel) {
      ioPanel.style.display = enabled ? ioPanel.style.display : 'none';
    }

	  if(!enabled) {
	    selectedPoint = null;
	    selectedLayer = null;
    clearMeshSelection();
    refreshSliceInputs();
	    dragging = false;
	    showScreenBounds = false;
      if(ioPanel) {
        ioPanel.style.display = 'none';
      }
      if(ioHelpPopup) {
        ioHelpPopup.style.display = 'none';
      }
      if(ioSlicePopup) {
        ioSlicePopup.style.display = 'none';
      }
      if(ioSchedulePopup) {
        ioSchedulePopup.style.display = 'none';
      }	  } else {
    refreshSliceInputs();
        refreshSubdivisionInputs();
        refreshEdgeBlendInputs();
        draw();
	  }
	};

	var clonePoints = function(points){
	  var clone = [];
	  for(var p = 0; p < points.length; p++){
	    clone.push( points[p].slice(0,2) );
	  }
	  return clone;
	};

	var cloneMeshPoints = function(points){
	  var clone = [];
	  if(!points) {
	    return clone;
	  }
	  for(var p = 0; p < points.length; p++){
	    if(points[p] && points[p].length >= 2) {
	      clone.push([Number(points[p][0]), Number(points[p][1])]);
	    }
	  }
	  return clone;
	};

  var createDefaultSliceData = function(width, height) {
    return {
      'id': 'slice-0',
      'enabled': true,
      'sourceRect': {
        'x': 0,
        'y': 0,
        'width': width,
        'height': height
      }
    };
  };

  var createDefaultMeshData = function(width, height) {
    return {
      'columns': 1,
      'rows': 1,
      'points': [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height]
      ]
    };
  };

  var createDefaultEdgeBlendData = function() {
    return {
      enabled: false,
      gamma: 1.78,
      sides: {
        left: { enabled: false, width: 0, smooth: 0.55 },
        right: { enabled: false, width: 0, smooth: 0.55 },
        top: { enabled: false, width: 0, smooth: 0.55 },
        bottom: { enabled: false, width: 0, smooth: 0.55 }
      }
    };
  };

  var normalizeEdgeBlendData = function(edgeBlendData) {
    var base = createDefaultEdgeBlendData();
    if(!edgeBlendData || typeof edgeBlendData !== 'object') {
      return base;
    }

    base.enabled = (edgeBlendData.enabled === true);
    base.gamma = Math.max(0.5, Math.min(3, Number(edgeBlendData.gamma || base.gamma)));

    var sideKeys = ['left', 'right', 'top', 'bottom'];
    var srcSides = edgeBlendData.sides || {};
    for(var i = 0; i < sideKeys.length; i++) {
      var key = sideKeys[i];
      var src = srcSides[key] || {};
      base.sides[key] = {
        enabled: (src.enabled === true),
        width: Math.max(0, Math.min(800, Number(src.width || 0))),
        smooth: Math.max(0, Math.min(1, Number(src.smooth || base.sides[key].smooth)))
      };
    }

    return base;
  };

  var cloneEdgeBlendData = function(edgeBlendData) {
    return normalizeEdgeBlendData(edgeBlendData);
  };
  var formatScheduleTime = function(value) {
    if(!value) {
      return '';
    }
    var raw = String(value).trim();
    if(raw === '') {
      return '';
    }
    var parts = raw.split(':');
    if(parts.length < 2) {
      return '';
    }
    var h = Number(parts[0]);
    var m = Number(parts[1]);
    var s = Number(parts.length > 2 ? parts[2] : 0);
    if(isNaN(h) || isNaN(m) || isNaN(s)) {
      return '';
    }
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    s = Math.max(0, Math.min(59, s));
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };

  var createDefaultScheduleData = function() {
    return {
      'enabled': true,
      'items': []
    };
  };

  var normalizeScheduleData = function(scheduleData) {
    var base = createDefaultScheduleData();
    if(!scheduleData || typeof scheduleData !== 'object') {
      return base;
    }

    base.enabled = (scheduleData.enabled !== false);
    var items = scheduleData.items || [];
    for(var i = 0; i < items.length; i++) {
      var timeVal = formatScheduleTime(items[i] && items[i].time);
      if(timeVal) {
        base.items.push({ time: timeVal });
      }
    }

    return base;
  };

  var cloneScheduleData = function(scheduleData) {
    return normalizeScheduleData(scheduleData);
  };
  var normalizeSliceData = function(sliceData, width, height) {
    var base = createDefaultSliceData(width, height);
    if(!sliceData || typeof sliceData !== 'object') {
      return base;
    }

    var rect = sliceData.sourceRect || {};
    base.id = String(sliceData.id || base.id);
    base.enabled = (sliceData.enabled !== false);
    base.sourceRect = {
      'x': Number(rect.x || 0),
      'y': Number(rect.y || 0),
      'width': Number(rect.width || width),
      'height': Number(rect.height || height)
    };
    return base;
  };

  var normalizeMeshData = function(meshData, width, height) {
    var base = createDefaultMeshData(width, height);
    if(!meshData || typeof meshData !== 'object') {
      return base;
    }

    var cols = Math.max(1, Number(meshData.columns || base.columns));
    var rows = Math.max(1, Number(meshData.rows || base.rows));
    var expected = (cols + 1) * (rows + 1);
    var pts = cloneMeshPoints(meshData.points);

    if(pts.length !== expected) {
      pts = [];
    }

    return {
      'columns': cols,
      'rows': rows,
      'points': pts
    };
  };

  var cloneSliceData = function(sliceData, width, height) {
    return normalizeSliceData(sliceData, width, height);
  };

  var cloneMeshData = function(meshData, width, height) {
    return normalizeMeshData(meshData, width, height);
  };

	var resize = function() {
	  viewWidth = window.innerWidth;
	  viewHeight = window.innerHeight;
	  canvas.width = window.innerWidth;
	  canvas.height = window.innerHeight;

	  draw();
	};

    var getLayout = function() {
    var layout = [];
    for(var i = 0; i < layers.length; i++) {
      layout.push({
        'id': layers[i].element.id,
        'targetPoints': clonePoints(layers[i].targetPoints),
        'sourcePoints': clonePoints(layers[i].sourcePoints),
        'slice': cloneSliceData(layers[i].slice, layers[i].width, layers[i].height),
        'mesh': cloneMeshData(layers[i].mesh, layers[i].width, layers[i].height),
        'schedule': cloneScheduleData(layers[i].schedule),
        'edgeBlend': cloneEdgeBlendData(layers[i].edgeBlend)
      });
    }
    return layout;
  }

  var setLayout = function(layout){
    for(var i = 0; i < layout.length; i++) {
      var exists = false;
      for(var n = 0; n < layers.length; n++){
        if(layers[n].element.id == layout[i].id) {
          layers[n].targetPoints = clonePoints(layout[i].targetPoints);
          layers[n].slice = normalizeSliceData(layout[i].slice, layers[n].width, layers[n].height);
          layers[n].mesh = normalizeMeshData(layout[i].mesh, layers[n].width, layers[n].height);
          layers[n].schedule = normalizeScheduleData(layout[i].schedule);
          layers[n].edgeBlend = normalizeEdgeBlendData(layout[i].edgeBlend);
          setSliceGeometry(layers[n], layers[n].slice.sourceRect);
            ensureLayerMesh(layers[n]);
          applyEdgeBlendToLayer(layers[n]);
          exists = true;
        }
      }

      if(!exists) {
        var element = document.getElementById(layout[i].id);
        if(element) {
          addLayer(element, layout[i].targetPoints, layout[i].slice, layout[i].mesh, layout[i].schedule, layout[i].edgeBlend);
        } else {
          console.log("Maptastic: Can't find element: " + layout[i].id);
        }
      }
    }
    updateTransform();
    draw();
  }

  init();

  // if the config was just an element or string, interpret it as a layer to add.

  for(var i = 0; i < layerList.length; i++){
    if((layerList[i] instanceof HTMLElement) || (typeof(layerList[i]) === 'string')) {
      addLayer(layerList[i]);
    }
  }

  for(var i = 0; i < arguments.length; i++){
    if((arguments[i] instanceof HTMLElement) || (typeof(arguments[i]) === 'string')) {
      addLayer(arguments[i]);
    }
  }

  if(autoLoad){
    loadSettings();
  }

 
  return {
  	'getLayout' : function() {
		  return getLayout();
		},
		'setLayout' : function(layout) {
			setLayout(layout);
		},
		'setConfigEnabled' : function(enabled){
			setConfigEnabled(enabled);
		},
		'addLayer' : function(target, targetPoints){
			addLayer(target, targetPoints);
		}
  }
};















































































































































































































































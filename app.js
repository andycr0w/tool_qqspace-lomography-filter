const canvas = document.querySelector('#previewCanvas');
const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const compareButton = document.querySelector('#compareButton');
const downloadButton = document.querySelector('#downloadButton');
const photoName = document.querySelector('#photoName');
const photoDate = document.querySelector('#photoDate');
const dateStamp = document.querySelector('#dateStamp');
const showDate = document.querySelector('#showDate');
const toast = document.querySelector('#toast');
const presetDescription = document.querySelector('#presetDescription');
const filterPanel = document.querySelector('#filterPanel');
const filterBackdrop = document.querySelector('#filterBackdrop');
const openFilterPanelButton = document.querySelector('#openFilterPanel');
const closeFilterPanelButton = document.querySelector('#closeFilterPanel');
const mobileFilterSummary = document.querySelector('#mobileFilterSummary');

const sliders = {
  intensity: document.querySelector('#intensity'),
  vignette: document.querySelector('#vignette'),
  grain: document.querySelector('#grain'),
  distortion: document.querySelector('#distortion')
};

const presets = {
  memory: {
    name: '旧时光',
    description: '泛黄、褪色，像翻出旧相册的午后。',
    transform: (r, g, b) => [r * 1.08 + g * .04 + 12, g * .97 + r * .04 + 6, b * .78 + g * .08 + 4],
    contrast: .92, fade: 15, leak: 0
  },
  youth: {
    name: '青涩夏日',
    description: '清凉青蓝压住暗部，像放学后的夏天。',
    transform: (r, g, b) => [r * .88 + g * .04 + 2, g * 1.02 + b * .05 + 8, b * 1.05 + g * .06 + 10],
    contrast: 1.08, fade: 5, leak: 0
  },
  leak: {
    name: '漏光日记',
    description: '一束橘红漏光，从相片左边悄悄烧进来。',
    transform: (r, g, b) => [r * 1.07 + 7, g * .94 + r * .03 + 3, b * .82 + 2],
    contrast: 1.04, fade: 6, leak: .7
  },
  night: {
    name: '夜游人间',
    description: '浓郁紫调和高反差，适合霓虹与夜色。',
    transform: (r, g, b) => [r * .98 + b * .08 + 4, g * .84 + b * .04, b * 1.08 + r * .04 + 6],
    contrast: 1.2, fade: 2, leak: .15
  }
};

const sourceCanvas = document.createElement('canvas');
let sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
const previewSourceCanvas = document.createElement('canvas');
const previewSourceCtx = previewSourceCanvas.getContext('2d', { willReadFrequently: true });
const distortionCanvas = document.createElement('canvas');
const distortionCtx = distortionCanvas.getContext('2d');
const mobileQuery = window.matchMedia('(max-width: 900px)');
const downloadButtonMarkup = downloadButton.innerHTML;

let currentPreset = 'memory';
let renderFrame = null;
let toastTimer = null;
let backdropTimer = null;
let isComparing = false;
let drawerOpen = false;

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function formatDate(value) {
  return value ? value.replaceAll('-', '.') : '';
}

function fastNoise(x, y) {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) & 1023) / 511.5 - 1;
}

function syncPreviewSource() {
  const previewMaxSide = 960;
  const scale = Math.min(1, previewMaxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  previewSourceCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  previewSourceCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  previewSourceCtx.clearRect(0, 0, previewSourceCanvas.width, previewSourceCanvas.height);
  previewSourceCtx.drawImage(sourceCanvas, 0, 0, previewSourceCanvas.width, previewSourceCanvas.height);
}

function drawDate(targetCtx, targetCanvas) {
  if (!showDate.checked || !photoDate.value) return;
  const text = formatDate(photoDate.value);
  const fontSize = Math.max(18, Math.round(targetCanvas.width * .026));
  targetCtx.save();
  targetCtx.font = `700 ${fontSize}px Consolas, monospace`;
  targetCtx.textAlign = 'right';
  targetCtx.textBaseline = 'bottom';
  targetCtx.shadowColor = 'rgba(65, 15, 5, .35)';
  targetCtx.shadowBlur = 2;
  targetCtx.fillStyle = 'rgba(242, 110, 72, .9)';
  targetCtx.fillText(text, targetCanvas.width - fontSize, targetCanvas.height - fontSize);
  targetCtx.restore();
}

function applyDigitalSoftness(targetCtx, targetCanvas, amount) {
  if (amount <= 0) return;

  const scale = 1 - amount * .55;
  const reducedWidth = Math.max(1, Math.round(targetCanvas.width * scale));
  const reducedHeight = Math.max(1, Math.round(targetCanvas.height * scale));

  if (distortionCanvas.width !== reducedWidth) distortionCanvas.width = reducedWidth;
  if (distortionCanvas.height !== reducedHeight) distortionCanvas.height = reducedHeight;

  distortionCtx.clearRect(0, 0, reducedWidth, reducedHeight);
  distortionCtx.imageSmoothingEnabled = true;
  distortionCtx.imageSmoothingQuality = 'low';
  distortionCtx.drawImage(targetCanvas, 0, 0, reducedWidth, reducedHeight);

  targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'low';
  targetCtx.drawImage(distortionCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
}

function applyFilter(source, target, includeDate = true) {
  target.width = source.width;
  target.height = source.height;
  const targetCtx = target.getContext('2d', { willReadFrequently: true });
  targetCtx.drawImage(source, 0, 0);

  const image = targetCtx.getImageData(0, 0, target.width, target.height);
  const data = image.data;
  const preset = presets[currentPreset];
  const intensity = Number(sliders.intensity.value) / 100;
  const vignette = Number(sliders.vignette.value) / 100;
  const grain = Number(sliders.grain.value) / 100;
  const distortion = Number(sliders.distortion.value) / 100;
  const quantizationStep = 1 + Math.round(distortion * 15);
  const inverseQuantizationStep = 1 / quantizationStep;
  const width = target.width;
  const height = target.height;
  const cx = width / 2;
  const cy = height / 2;
  const inverseMaxDistanceSquared = 1 / (cx * cx + cy * cy);
  const blockErrors = distortion > 0 ? new Float32Array(Math.ceil(width / 8)) : null;

  for (let y = 0; y < height; y++) {
    const centerY = y - cy;
    const normalizedY = y / height;

    if (blockErrors && y % 8 === 0) {
      const blockY = Math.floor(y / 8);
      for (let blockX = 0; blockX < blockErrors.length; blockX++) {
        blockErrors[blockX] = fastNoise(blockX, blockY) * distortion * 6;
      }
    }

    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const originalR = data[index];
      const originalG = data[index + 1];
      const originalB = data[index + 2];
      let [r, g, b] = preset.transform(originalR, originalG, originalB);

      r = (r - 128) * preset.contrast + 128 + preset.fade;
      g = (g - 128) * preset.contrast + 128 + preset.fade;
      b = (b - 128) * preset.contrast + 128 + preset.fade;

      const centerX = x - cx;
      const distanceSquared = (centerX * centerX + centerY * centerY) * inverseMaxDistanceSquared;
      const edge = Math.max(0, (distanceSquared - .12) / .88);
      const shade = 1 - edge * edge * vignette * .78;
      r *= shade;
      g *= shade;
      b *= shade;

      if (preset.leak > 0) {
        const normalizedX = x / width;
        const leakDistanceSquared = (normalizedX + .03) ** 2 + (normalizedY - .28) ** 2;
        const leak = Math.max(0, 1 - leakDistanceSquared / .34) * preset.leak;
        r += 115 * leak;
        g += 48 * leak;
        b += 12 * leak;
      }

      const noise = fastNoise(x, y) * grain * 23;
      r += noise;
      g += noise;
      b += noise;

      const mixedR = originalR + (r - originalR) * intensity;
      const mixedG = originalG + (g - originalG) * intensity;
      const mixedB = originalB + (b - originalB) * intensity;

      if (distortion > 0) {
        const blockError = blockErrors[Math.floor(x / 8)];
        data[index] = clamp(Math.round((mixedR + blockError) * inverseQuantizationStep) * quantizationStep);
        data[index + 1] = clamp(Math.round((mixedG + blockError) * inverseQuantizationStep) * quantizationStep);
        data[index + 2] = clamp(Math.round((mixedB + blockError) * inverseQuantizationStep) * quantizationStep);
      } else {
        data[index] = clamp(mixedR);
        data[index + 1] = clamp(mixedG);
        data[index + 2] = clamp(mixedB);
      }
    }
  }

  targetCtx.putImageData(image, 0, 0);
  applyDigitalSoftness(targetCtx, target, distortion);
  if (includeDate) drawDate(targetCtx, target);
}

function render(originalOnly = isComparing) {
  if (!previewSourceCanvas.width || !previewSourceCanvas.height) return;

  if (originalOnly) {
    canvas.width = previewSourceCanvas.width;
    canvas.height = previewSourceCanvas.height;
    canvas.getContext('2d').drawImage(previewSourceCanvas, 0, 0);
    return;
  }

  applyFilter(previewSourceCanvas, canvas);
}

function scheduleRender() {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    render();
  });
}

function createSample() {
  const width = 1200;
  const height = 800;
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  const sky = sourceCtx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#a9d6db');
  sky.addColorStop(.58, '#f2d7a4');
  sky.addColorStop(1, '#bd8a58');
  sourceCtx.fillStyle = sky;
  sourceCtx.fillRect(0, 0, width, height);

  sourceCtx.globalAlpha = .45;
  sourceCtx.fillStyle = '#fff5c6';
  sourceCtx.beginPath();
  sourceCtx.arc(880, 210, 90, 0, Math.PI * 2);
  sourceCtx.fill();
  sourceCtx.globalAlpha = 1;

  sourceCtx.fillStyle = '#58766b';
  sourceCtx.beginPath();
  sourceCtx.moveTo(0, 540);
  sourceCtx.bezierCurveTo(240, 410, 410, 550, 650, 455);
  sourceCtx.bezierCurveTo(810, 390, 1010, 455, 1200, 350);
  sourceCtx.lineTo(1200, 800);
  sourceCtx.lineTo(0, 800);
  sourceCtx.fill();

  sourceCtx.fillStyle = '#354f4c';
  sourceCtx.fillRect(0, 620, width, 180);
  for (let x = 20; x < width; x += 62) {
    sourceCtx.fillStyle = x % 124 ? '#294741' : '#43645c';
    sourceCtx.beginPath();
    sourceCtx.arc(x, 602 - (x % 3) * 10, 54 + (x % 4) * 5, 0, Math.PI * 2);
    sourceCtx.fill();
  }

  sourceCtx.strokeStyle = '#263a3a';
  sourceCtx.lineWidth = 10;
  sourceCtx.beginPath();
  sourceCtx.arc(505, 665, 62, 0, Math.PI * 2);
  sourceCtx.arc(680, 665, 62, 0, Math.PI * 2);
  sourceCtx.stroke();
  sourceCtx.lineWidth = 7;
  sourceCtx.beginPath();
  sourceCtx.moveTo(505, 665);
  sourceCtx.lineTo(565, 565);
  sourceCtx.lineTo(680, 665);
  sourceCtx.lineTo(550, 665);
  sourceCtx.lineTo(625, 590);
  sourceCtx.lineTo(565, 565);
  sourceCtx.moveTo(625, 590);
  sourceCtx.lineTo(663, 560);
  sourceCtx.stroke();

  sourceCtx.fillStyle = 'rgba(255,255,255,.2)';
  for (let i = 0; i < 24; i++) {
    sourceCtx.beginPath();
    sourceCtx.arc((i * 191) % width, (i * 97) % height, 1 + (i % 3), 0, Math.PI * 2);
    sourceCtx.fill();
  }

  syncPreviewSource();
  render();
}

function loadFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('请选择 JPG、PNG 或 WebP 图片');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('图片超过 20MB，请换一张小一点的');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const exportMaxSide = 3200;
      const exportScale = Math.min(1, exportMaxSide / Math.max(image.naturalWidth, image.naturalHeight));
      sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * exportScale));
      sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * exportScale));
      sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      syncPreviewSource();
      photoName.textContent = file.name;
      render();
      showToast('照片已应用当前滤镜');
    };
    image.onerror = () => showToast('这张图片无法读取，请换一张试试');
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setComparing(value) {
  if (value === isComparing) return;
  isComparing = value;
  compareButton.classList.toggle('is-comparing', value);
  compareButton.setAttribute('aria-pressed', String(value));
  scheduleRender();
}

function updateMobileSummary() {
  mobileFilterSummary.textContent = `${presets[currentPreset].name} · 浓度 ${sliders.intensity.value}%`;
}

function focusableDrawerElements() {
  return [...filterPanel.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.disabled && element.getClientRects().length);
}

function openDrawer() {
  if (!mobileQuery.matches || drawerOpen) return;
  drawerOpen = true;
  filterPanel.scrollTop = 0;
  clearTimeout(backdropTimer);
  filterBackdrop.hidden = false;
  filterPanel.classList.add('is-open');
  filterBackdrop.classList.add('is-visible');
  document.body.classList.add('filter-drawer-open');
  filterPanel.setAttribute('role', 'dialog');
  filterPanel.setAttribute('aria-modal', 'true');
  filterPanel.setAttribute('aria-hidden', 'false');
  openFilterPanelButton.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => closeFilterPanelButton.focus());
}

function closeDrawer(restoreFocus = true) {
  if (!drawerOpen) return;
  drawerOpen = false;
  filterPanel.classList.remove('is-open');
  filterBackdrop.classList.remove('is-visible');
  document.body.classList.remove('filter-drawer-open');
  filterPanel.setAttribute('aria-hidden', 'true');
  openFilterPanelButton.setAttribute('aria-expanded', 'false');
  filterPanel.removeAttribute('aria-modal');
  filterPanel.removeAttribute('role');
  backdropTimer = setTimeout(() => {
    if (!drawerOpen) filterBackdrop.hidden = true;
  }, 230);
  if (restoreFocus) openFilterPanelButton.focus();
}

function syncResponsiveMode() {
  document.body.classList.toggle('has-filter-drawer', mobileQuery.matches);
  if (mobileQuery.matches) {
    if (!drawerOpen) filterPanel.setAttribute('aria-hidden', 'true');
  } else {
    if (drawerOpen) closeDrawer(false);
    filterPanel.setAttribute('aria-hidden', 'false');
    filterPanel.removeAttribute('role');
    filterPanel.removeAttribute('aria-modal');
    filterBackdrop.hidden = true;
  }
}

fileInput.addEventListener('change', event => loadFile(event.target.files[0]));

['dragenter', 'dragover'].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
});

['dragleave', 'drop'].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
});

dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));

document.querySelectorAll('.preset').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-checked', String(active));
    });
    currentPreset = button.dataset.preset;
    presetDescription.textContent = presets[currentPreset].description;
    updateMobileSummary();
    scheduleRender();
  });
});

Object.entries(sliders).forEach(([name, slider]) => {
  const output = document.querySelector(`#${name}Value`);
  const update = () => {
    output.value = `${slider.value}%`;
    slider.style.setProperty('--range', `${slider.value}%`);
    updateMobileSummary();
    scheduleRender();
  };
  slider.addEventListener('input', update);
  slider.addEventListener('change', update);
  update();
});

photoDate.addEventListener('input', () => {
  dateStamp.textContent = formatDate(photoDate.value);
  scheduleRender();
});

showDate.addEventListener('change', () => {
  dateStamp.hidden = !showDate.checked;
  scheduleRender();
});

compareButton.addEventListener('pointerdown', event => {
  event.preventDefault();
  compareButton.setPointerCapture?.(event.pointerId);
  setComparing(true);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
  compareButton.addEventListener(type, () => setComparing(false));
});
compareButton.addEventListener('keydown', event => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) setComparing(true);
});
compareButton.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') setComparing(false);
});

openFilterPanelButton.addEventListener('click', openDrawer);
closeFilterPanelButton.addEventListener('click', () => closeDrawer());
filterBackdrop.addEventListener('click', () => closeDrawer());

document.addEventListener('keydown', event => {
  if (!drawerOpen) return;
  if (event.key === 'Escape') {
    closeDrawer();
    return;
  }
  if (event.key !== 'Tab') return;
  const elements = focusableDrawerElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

mobileQuery.addEventListener?.('change', syncResponsiveMode);

downloadButton.addEventListener('click', () => {
  if (isComparing) setComparing(false);
  downloadButton.disabled = true;
  downloadButton.textContent = '正在冲印高清照片…';

  requestAnimationFrame(() => {
    setTimeout(() => {
      const exportCanvas = document.createElement('canvas');
      applyFilter(sourceCanvas, exportCanvas);
      exportCanvas.toBlob(blob => {
        downloadButton.disabled = false;
        downloadButton.innerHTML = downloadButtonMarkup;
        if (!blob) {
          showToast('导出失败，请再试一次');
          return;
        }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `拾光LOMO_${currentPreset}_${photoDate.value || 'memory'}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        showToast('回忆已保存为 PNG');
      }, 'image/png');
    }, 30);
  });
});

syncResponsiveMode();
updateMobileSummary();
createSample();

const knowledgeNodes = [
  {
    id: "calculus",
    name: "微积分",
    region: "数理基础",
    x: 235,
    y: 205,
    difficulty: 2,
    description: "研究连续变化、极限、导数与积分，是后续信号、电路分析的数学底座。",
    prerequisites: ["函数", "极限"]
  },
  {
    id: "linear_algebra",
    name: "线性代数",
    region: "数理基础",
    x: 375,
    y: 235,
    difficulty: 2,
    description: "用向量、矩阵和线性变换描述系统结构，是状态空间与数字信号处理的基础。",
    prerequisites: ["向量", "方程组"]
  },
  {
    id: "complex_number",
    name: "复指数",
    region: "数理基础",
    x: 315,
    y: 345,
    difficulty: 2,
    description: "用复数和指数形式刻画振荡、相位和旋转，连接数学表达与工程信号。",
    prerequisites: ["三角函数", "欧拉公式"]
  },
  {
    id: "probability",
    name: "概率统计",
    region: "数理基础",
    x: 160,
    y: 325,
    difficulty: 3,
    description: "描述随机现象与不确定性，是噪声建模、通信系统和估计问题的基础。",
    prerequisites: ["集合", "随机变量"]
  },
  {
    id: "signal_classification",
    name: "信号分类",
    region: "信号系统",
    x: 935,
    y: 160,
    difficulty: 1,
    description: "区分连续与离散、周期与非周期、能量与功率信号，建立信号分析入口。",
    prerequisites: ["函数", "复指数"]
  },
  {
    id: "fourier",
    name: "傅里叶变换",
    region: "信号系统",
    x: 1070,
    y: 245,
    difficulty: 3,
    description: "将信号从时域转换到频域，是信号分析的核心工具。",
    prerequisites: ["微积分", "复指数", "信号分类"]
  },
  {
    id: "laplace",
    name: "拉普拉斯变换",
    region: "信号系统",
    x: 910,
    y: 305,
    difficulty: 3,
    description: "把微分方程转化为代数问题，用于连续系统建模、稳定性和瞬态分析。",
    prerequisites: ["微积分", "复指数"]
  },
  {
    id: "sampling",
    name: "采样定理",
    region: "信号系统",
    x: 1160,
    y: 370,
    difficulty: 3,
    description: "说明连续信号被离散化时的频率限制，是数字处理和通信链路的关键规则。",
    prerequisites: ["傅里叶变换", "信号分类"]
  },
  {
    id: "circuit_laws",
    name: "基尔霍夫定律",
    region: "电子电路与系统",
    x: 245,
    y: 620,
    difficulty: 2,
    description: "用节点电流和回路电压约束电路变量，是所有电路分析的第一性工具。",
    prerequisites: ["电压电流", "线性方程"]
  },
  {
    id: "op_amp",
    name: "运算放大器",
    region: "电子电路与系统",
    x: 415,
    y: 565,
    difficulty: 3,
    description: "利用高增益差分放大器构建放大、滤波、积分和比较等模拟功能模块。",
    prerequisites: ["基尔霍夫定律", "反馈"]
  },
  {
    id: "filter",
    name: "模拟滤波器",
    region: "电子电路与系统",
    x: 555,
    y: 715,
    difficulty: 4,
    description: "通过电路网络选择性保留或抑制频率成分，是信号链路中的基础系统。",
    prerequisites: ["傅里叶变换", "运算放大器", "拉普拉斯变换"]
  },
  {
    id: "feedback",
    name: "反馈系统",
    region: "电子电路与系统",
    x: 335,
    y: 765,
    difficulty: 4,
    description: "利用输出反作用于输入，改变增益、带宽、稳定性和误差特性。",
    prerequisites: ["拉普拉斯变换", "基尔霍夫定律"]
  },
  {
    id: "boolean",
    name: "布尔代数",
    region: "数字电路",
    x: 945,
    y: 615,
    difficulty: 2,
    description: "用逻辑变量与运算描述开关系统，是组合逻辑设计的形式语言。",
    prerequisites: ["集合", "逻辑命题"]
  },
  {
    id: "logic_gate",
    name: "逻辑门",
    region: "数字电路",
    x: 1110,
    y: 655,
    difficulty: 2,
    description: "用与、或、非等基本门电路实现数字信号的逻辑运算。",
    prerequisites: ["布尔代数"]
  },
  {
    id: "fsm",
    name: "有限状态机",
    region: "数字电路",
    x: 1000,
    y: 795,
    difficulty: 4,
    description: "用状态、转移和输出描述时序逻辑系统，是控制器设计的核心模型。",
    prerequisites: ["逻辑门", "触发器"]
  },
  {
    id: "verilog",
    name: "Verilog 建模",
    region: "数字电路",
    x: 1185,
    y: 815,
    difficulty: 3,
    description: "使用硬件描述语言表达组合逻辑、时序逻辑和模块层次结构。",
    prerequisites: ["逻辑门", "有限状态机"]
  }
];

const knowledgeEdges = [
  { from: "calculus", to: "fourier", type: "prerequisite" },
  { from: "complex_number", to: "fourier", type: "prerequisite" },
  { from: "signal_classification", to: "fourier", type: "prerequisite" },
  { from: "calculus", to: "laplace", type: "prerequisite" },
  { from: "complex_number", to: "laplace", type: "prerequisite" },
  { from: "fourier", to: "sampling", type: "prerequisite" },
  { from: "laplace", to: "feedback", type: "prerequisite" },
  { from: "laplace", to: "filter", type: "prerequisite" },
  { from: "fourier", to: "filter", type: "related" },
  { from: "circuit_laws", to: "op_amp", type: "prerequisite" },
  { from: "op_amp", to: "filter", type: "prerequisite" },
  { from: "circuit_laws", to: "feedback", type: "related" },
  { from: "boolean", to: "logic_gate", type: "prerequisite" },
  { from: "logic_gate", to: "fsm", type: "prerequisite" },
  { from: "logic_gate", to: "verilog", type: "prerequisite" },
  { from: "fsm", to: "verilog", type: "prerequisite" },
  { from: "linear_algebra", to: "fsm", type: "related" },
  { from: "sampling", to: "verilog", type: "related" }
];

const knowledgeRegions = [
  {
    name: "数理基础",
    labelX: 275,
    labelY: 120,
    image: "./assets/math_island.webp",
    mobileImage: "./assets/math_island_mobile.webp",
    imageX: 10,
    imageY: -20,
    imageWidth: 500,
    imageHeight: 500,
    polygon: "150,175 245,105 420,112 535,210 500,380 340,455 170,405 95,280",
    surface: "190,205 285,150 420,158 500,232 470,345 330,400 205,360 145,275"
  },
  {
    name: "信号系统",
    labelX: 1055,
    labelY: 115,
    image: "./assets/signals_island.webp",
    mobileImage: "./assets/signals_island_mobile.webp",
    imageX: 810,
    imageY: -5,
    imageWidth: 520,
    imageHeight: 520,
    polygon: "625,125 760,55 960,95 1060,245 1015,425 845,485 650,410 580,245",
    surface: "665,150 770,105 925,130 1008,252 970,382 835,430 685,378 630,248"
  },
  {
    name: "电子电路与系统",
    labelX: 365,
    labelY: 515,
    image: "./assets/circuits_island.webp",
    mobileImage: "./assets/circuits_island_mobile.webp",
    imageX: 35,
    imageY: 405,
    imageWidth: 555,
    imageHeight: 555,
    polygon: "175,535 345,460 560,500 690,640 635,800 430,850 215,790 105,650",
    surface: "220,570 360,515 535,545 625,655 585,760 425,800 250,750 160,650"
  },
  {
    name: "数字电路",
    labelX: 1075,
    labelY: 550,
    image: "./assets/digital_island.webp",
    mobileImage: "./assets/digital_island_mobile.webp",
    imageX: 805,
    imageY: 445,
    imageWidth: 540,
    imageHeight: 540,
    polygon: "960,520 1120,455 1300,520 1355,680 1285,835 1090,860 930,760 900,615",
    surface: "995,555 1125,505 1260,550 1305,680 1250,795 1098,812 975,735 950,625"
  }
];

const mapState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  minScale: 0.62,
  maxScale: 2.4,
  activeNodeId: "",
  highlightedNodeId: "",
  mobileRegionIndex: 0
};

const floatConfigs = {
  数理基础: { amplitude: 8, duration: 7800, phase: 0.4 },
  信号系统: { amplitude: 7, duration: 9600, phase: 2.1 },
  电子电路与系统: { amplitude: 9, duration: 8700, phase: 4.2 },
  数字电路: { amplitude: 7, duration: 10400, phase: 1.3 }
};

const nodeById = new Map(knowledgeNodes.map((node) => [node.id, node]));
const mobileRegionNames = knowledgeRegions.map((region) => region.name);

let svg;
let viewport;
let regionLayer;
let edgeLayer;
let nodeLayer;
let tooltip;
let animationFrameId = 0;
let currentImageMode = "";

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateViewportTransform() {
  viewport.setAttribute("transform", `translate(${mapState.translateX} ${mapState.translateY}) scale(${mapState.scale})`);
}

function renderMap() {
  svg = document.getElementById("knowledge-map");
  viewport = document.getElementById("map-viewport");
  regionLayer = document.getElementById("region-layer");
  edgeLayer = document.getElementById("edge-layer");
  nodeLayer = document.getElementById("node-layer");
  tooltip = document.getElementById("world-tooltip");

  if (!svg || !viewport || !regionLayer || !edgeLayer || !nodeLayer) {
    return;
  }

  renderRegions();
  renderEdges();
  renderNodes();
  updateViewportTransform();
  startFloatingMotion();
  applyMobileIslandView({ center: true });
}

function renderRegions() {
  regionLayer.replaceChildren();

  knowledgeRegions.forEach((region) => {
    const group = createSvgElement("g", {
      class: "knowledge-region",
      "data-region": region.name
    });
    const shadow = createSvgElement("ellipse", {
      class: "region-shadow",
      cx: region.imageX + region.imageWidth / 2,
      cy: region.imageY + region.imageHeight * 0.72,
      rx: region.imageWidth * 0.35,
      ry: region.imageHeight * 0.12
    });
    const image = createSvgElement("image", {
      class: "region-island-image",
      "data-region": region.name,
      x: region.imageX,
      y: region.imageY,
      width: region.imageWidth,
      height: region.imageHeight,
      preserveAspectRatio: "xMidYMid meet"
    });
    const imageHref = getRegionImageHref(region);

    if (imageHref) {
      image.setAttribute("href", imageHref);
    }
    const label = createSvgElement("text", {
      class: "region-label",
      x: region.labelX,
      y: region.labelY
    });

    label.textContent = region.name;
    group.append(shadow, image, label);
    regionLayer.append(group);
  });
}

function renderEdges() {
  edgeLayer.replaceChildren();

  knowledgeEdges.forEach((edge) => {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);

    if (!fromNode || !toNode) {
      return;
    }

    const line = createSvgElement("line", {
      class: `knowledge-edge ${edge.type === "related" ? "related" : ""}`,
      "data-from": edge.from,
      "data-to": edge.to,
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y
    });
    edgeLayer.append(line);
  });
}

function renderNodes() {
  nodeLayer.replaceChildren();

  knowledgeNodes.forEach((node) => {
    const group = createSvgElement("g", {
      class: "knowledge-node",
      "data-node-id": node.id,
      "data-region": node.region,
      tabindex: "0",
      role: "button",
      "aria-label": `${node.name}，${node.region}`
    });
    const radius = 8 + node.difficulty * 1.8;

    const halo = createSvgElement("circle", {
      class: "node-halo",
      cx: node.x,
      cy: node.y,
      r: radius + 11
    });
    const core = createSvgElement("circle", {
      class: "node-core",
      cx: node.x,
      cy: node.y,
      r: radius
    });
    const hit = createSvgElement("circle", {
      class: "node-hit",
      cx: node.x,
      cy: node.y,
      r: Math.max(28, radius + 14)
    });
    const label = createSvgElement("text", {
      class: "node-label",
      x: node.x,
      y: node.y + radius + 24
    });

    label.textContent = node.name;
    group.append(halo, core, hit, label);

    group.addEventListener("mouseenter", (event) => showTooltip(event, node));
    group.addEventListener("mousemove", moveTooltip);
    group.addEventListener("mouseleave", hideTooltip);
    group.addEventListener("click", () => openDetailPanel(node));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetailPanel(node);
      }
    });

    nodeLayer.append(group);
  });
}

function startFloatingMotion() {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion) {
    return;
  }

  const animate = (timestamp) => {
    const offsets = getRegionFloatOffsets(timestamp);

    document.querySelectorAll(".knowledge-region").forEach((element) => {
      const offset = offsets[element.dataset.region] || 0;
      element.setAttribute("transform", `translate(0 ${offset.toFixed(2)})`);
    });

    document.querySelectorAll(".knowledge-node").forEach((element) => {
      const offset = offsets[element.dataset.region] || 0;
      element.setAttribute("transform", `translate(0 ${offset.toFixed(2)})`);
    });

    document.querySelectorAll(".knowledge-edge").forEach((element) => {
      const fromNode = nodeById.get(element.dataset.from);
      const toNode = nodeById.get(element.dataset.to);

      if (!fromNode || !toNode) {
        return;
      }

      element.setAttribute("y1", fromNode.y + (offsets[fromNode.region] || 0));
      element.setAttribute("y2", toNode.y + (offsets[toNode.region] || 0));
    });

    animationFrameId = window.requestAnimationFrame(animate);
  };

  animationFrameId = window.requestAnimationFrame(animate);
}

function getRegionFloatOffsets(timestamp) {
  return Object.fromEntries(
    Object.entries(floatConfigs).map(([region, config]) => {
      const progress = (timestamp / config.duration) * Math.PI * 2 + config.phase;
      return [region, Math.sin(progress) * config.amplitude];
    })
  );
}

function openDetailPanel(node) {
  const panel = document.getElementById("world-detail-panel");

  if (!panel) {
    return;
  }

  mapState.activeNodeId = node.id;
  setNodeClasses();

  const prerequisites = node.prerequisites.length
    ? node.prerequisites.map((item) => `<span class="detail-chip">${escapeHtml(item)}</span>`).join("")
    : '<span class="detail-chip">无</span>';
  const stars = "★".repeat(node.difficulty) + "☆".repeat(5 - node.difficulty);

  panel.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(node.name)}</h2>
      </div>
      <button class="detail-close" type="button" aria-label="关闭详情">×</button>
    </div>
    <p class="detail-description">${escapeHtml(node.description)}</p>
    <div class="detail-meta">
      <div class="detail-row">
        <span>所属区域</span>
        <strong>${escapeHtml(node.region)}</strong>
      </div>
      <div class="detail-row">
        <span>难度</span>
        <strong class="difficulty-stars" aria-label="${node.difficulty} 星难度">${stars}</strong>
      </div>
      <div class="detail-row">
        <span>前置知识</span>
        <div class="detail-prerequisites">${prerequisites}</div>
      </div>
    </div>
    <button class="detail-action" type="button">进入学习</button>
  `;
  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
  panel.querySelector(".detail-close")?.addEventListener("click", closeDetailPanel);
}

function setupSearch() {
  const form = document.getElementById("world-search-form");
  const input = document.getElementById("world-search-input");

  if (!form || !input) {
    return;
  }

  const focusNode = (query) => {
    const keyword = query.trim().toLowerCase();
    const node = knowledgeNodes.find((item) => {
      return item.name.toLowerCase().includes(keyword) || item.region.toLowerCase().includes(keyword);
    });

    if (!keyword || !node) {
      mapState.highlightedNodeId = "";
      setNodeClasses();
      return;
    }

    const regionIndex = mobileRegionNames.indexOf(node.region);
    if (regionIndex >= 0) {
      mapState.mobileRegionIndex = regionIndex;
      applyMobileIslandView({ center: false });
    }

    mapState.highlightedNodeId = node.id;
    centerOnNode(node);
    openDetailPanel(node);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    focusNode(input.value);
  });

  input.addEventListener("input", () => {
    focusNode(input.value);
  });
}

function setupMobileIslandSwitcher() {
  const previousButton = document.getElementById("mobile-prev-island");
  const nextButton = document.getElementById("mobile-next-island");

  if (!previousButton || !nextButton) {
    return;
  }

  previousButton.addEventListener("click", () => switchMobileIsland(-1));
  nextButton.addEventListener("click", () => switchMobileIsland(1));

  window.matchMedia("(max-width: 680px)").addEventListener("change", () => {
    applyMobileIslandView({ center: true });
  });
  window.addEventListener("resize", () => {
    applyMobileIslandView({ center: false });
  });
}

function switchMobileIsland(direction) {
  const nextIndex = (mapState.mobileRegionIndex + direction + mobileRegionNames.length) % mobileRegionNames.length;
  mapState.mobileRegionIndex = nextIndex;
  mapState.highlightedNodeId = "";
  closeDetailPanel();
  applyMobileIslandView({ center: true });
}

function applyMobileIslandView({ center = false } = {}) {
  if (!svg) {
    return;
  }

  const activeRegion = mobileRegionNames[mapState.mobileRegionIndex];
  const label = document.getElementById("mobile-island-label");
  const isMobile = isMobileIslandMode();
  updateRegionImageSources(isMobile);

  if (label) {
    label.textContent = activeRegion;
  }

  document.querySelectorAll(".knowledge-region").forEach((element) => {
    element.classList.toggle("is-mobile-hidden", isMobile && element.dataset.region !== activeRegion);
  });

  document.querySelectorAll(".knowledge-node").forEach((element) => {
    element.classList.toggle("is-mobile-hidden", isMobile && element.dataset.region !== activeRegion);
  });

  document.querySelectorAll(".knowledge-edge").forEach((element) => {
    const fromNode = nodeById.get(element.dataset.from);
    const toNode = nodeById.get(element.dataset.to);
    const isActiveEdge = fromNode?.region === activeRegion && toNode?.region === activeRegion;
    element.classList.toggle("is-mobile-hidden", isMobile && !isActiveEdge);
  });

  if (isMobile && center) {
    centerOnRegion(activeRegion);
  }
}

function isMobileIslandMode() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function getRegionImageHref(region) {
  if (!isMobileIslandMode()) {
    return region.image;
  }

  return region.name === mobileRegionNames[mapState.mobileRegionIndex] ? region.mobileImage : "";
}

function updateRegionImageSources(isMobile = isMobileIslandMode()) {
  const mode = isMobile ? `mobile:${mobileRegionNames[mapState.mobileRegionIndex]}` : "desktop";

  if (mode === currentImageMode) {
    return;
  }

  currentImageMode = mode;
  document.querySelectorAll(".region-island-image").forEach((imageElement) => {
    const region = knowledgeRegions.find((item) => item.name === imageElement.dataset.region);

    if (!region) {
      return;
    }

    if (!isMobile) {
      imageElement.setAttribute("href", region.image);
      return;
    }

    if (region.name === mobileRegionNames[mapState.mobileRegionIndex]) {
      imageElement.setAttribute("href", region.mobileImage);
    } else {
      imageElement.removeAttribute("href");
    }
  });
}

function closeDetailPanel() {
  const panel = document.getElementById("world-detail-panel");

  if (!panel) {
    return;
  }

  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  mapState.activeNodeId = "";
  setNodeClasses();
}

function setupZoomAndPan() {
  if (!svg || !viewport) {
    return;
  }

  const zoomAt = (delta, clientX, clientY) => {
    const svgPoint = clientToSvgPoint(clientX, clientY);
    const pointBefore = screenToMapPoint(clientX, clientY);
    const nextScale = Math.min(mapState.maxScale, Math.max(mapState.minScale, mapState.scale * delta));

    mapState.scale = nextScale;

    mapState.translateX = svgPoint.x - pointBefore.x * mapState.scale;
    mapState.translateY = svgPoint.y - pointBefore.y * mapState.scale;
    updateViewportTransform();
  };

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 0.9 : 1.1, event.clientX, event.clientY);
  }, { passive: false });

  let isPanning = false;
  let startPoint = { x: 0, y: 0 };
  let startTranslateX = 0;
  let startTranslateY = 0;

  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest && event.target.closest(".knowledge-node")) {
      return;
    }

    isPanning = true;
    startPoint = clientToSvgPoint(event.clientX, event.clientY);
    startTranslateX = mapState.translateX;
    startTranslateY = mapState.translateY;
    svg.classList.add("is-panning");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!isPanning) {
      return;
    }

    const point = clientToSvgPoint(event.clientX, event.clientY);
    mapState.translateX = startTranslateX + point.x - startPoint.x;
    mapState.translateY = startTranslateY + point.y - startPoint.y;
    updateViewportTransform();
  });

  const stopPanning = (event) => {
    if (!isPanning) {
      return;
    }

    isPanning = false;
    svg.classList.remove("is-panning");

    if (event.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  };

  svg.addEventListener("pointerup", stopPanning);
  svg.addEventListener("pointercancel", stopPanning);
  svg.addEventListener("pointerleave", stopPanning);

  document.getElementById("zoom-in")?.addEventListener("click", () => zoomAt(1.14, window.innerWidth / 2, window.innerHeight / 2));
  document.getElementById("zoom-out")?.addEventListener("click", () => zoomAt(0.88, window.innerWidth / 2, window.innerHeight / 2));
  document.getElementById("zoom-reset")?.addEventListener("click", () => {
    mapState.scale = 1;
    mapState.translateX = 0;
    mapState.translateY = 0;
    updateViewportTransform();
    applyMobileIslandView({ center: true });
  });
}

function screenToMapPoint(clientX, clientY) {
  const svgPoint = clientToSvgPoint(clientX, clientY);

  return {
    x: (svgPoint.x - mapState.translateX) / mapState.scale,
    y: (svgPoint.y - mapState.translateY) / mapState.scale
  };
}

function clientToSvgPoint(clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function centerOnNode(node) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  mapState.scale = Math.max(mapState.scale, 1.22);

  const targetX = viewBox.width / 2 - node.x * mapState.scale;
  const targetY = viewBox.height / 2 - node.y * mapState.scale;

  mapState.translateX = targetX + (rect.width < 720 ? 0 : -80);
  mapState.translateY = targetY;
  updateViewportTransform();
}

function centerOnRegion(regionName) {
  const region = knowledgeRegions.find((item) => item.name === regionName);

  if (!region || !svg) {
    return;
  }

  const viewBox = svg.viewBox.baseVal;
  const centerX = region.imageX + region.imageWidth / 2;
  const centerY = region.imageY + region.imageHeight / 2;
  mapState.scale = 2.4;
  mapState.translateX = viewBox.width / 2 - centerX * mapState.scale;
  mapState.translateY = viewBox.height / 2 - centerY * mapState.scale - 12;
  updateViewportTransform();
}

function setNodeClasses() {
  document.querySelectorAll(".knowledge-node").forEach((element) => {
    const nodeId = element.dataset.nodeId;
    const hasSearch = Boolean(mapState.highlightedNodeId);
    const isActive = nodeId === mapState.activeNodeId;
    const isHighlighted = nodeId === mapState.highlightedNodeId;

    element.classList.toggle("is-active", isActive);
    element.classList.toggle("is-highlighted", isHighlighted);
    element.classList.toggle("is-muted", hasSearch && !isHighlighted);
  });
}

function showTooltip(event, node) {
  if (!tooltip) {
    return;
  }

  tooltip.innerHTML = `<strong>${escapeHtml(node.name)}</strong><br>${escapeHtml(node.region)} · 难度 ${node.difficulty}`;
  tooltip.classList.add("is-visible");
  moveTooltip(event);
}

function moveTooltip(event) {
  if (!tooltip) {
    return;
  }

  const card = document.getElementById("world-map-card");
  const rect = card.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left}px`;
  tooltip.style.top = `${event.clientY - rect.top}px`;
}

function hideTooltip() {
  tooltip?.classList.remove("is-visible");
}

document.addEventListener("DOMContentLoaded", () => {
  renderMap();
  setupSearch();
  setupZoomAndPan();
  setupMobileIslandSwitcher();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDetailPanel();
    }
  });

  document.addEventListener("click", (event) => {
    const panel = document.getElementById("world-detail-panel");
    const clickedPanel = event.target.closest?.("#world-detail-panel");
    const clickedNode = event.target.closest?.(".knowledge-node");
    const clickedSearch = event.target.closest?.("#world-search-form");

    if (panel?.classList.contains("is-open") && !clickedPanel && !clickedNode && !clickedSearch) {
      closeDetailPanel();
    }
  });
});

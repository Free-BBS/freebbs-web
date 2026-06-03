const studyWorlds = [
  {
    name: "数理基础",
    image: "/assets/math_island.webp",
    mobileImage: "/assets/math_island_mobile.webp",
    board: "math",
    description: "从微积分、线性代数、复指数到概率统计，为后续信号、电路和系统分析打底。",
    tags: ["微积分", "线性代数", "概率统计"]
  },
  {
    name: "信号系统",
    image: "/assets/signals_island.webp",
    mobileImage: "/assets/signals_island_mobile.webp",
    board: "signal",
    description: "围绕信号分类、傅里叶、拉普拉斯与采样定理，理解时域和频域之间的转换。",
    tags: ["傅里叶", "拉普拉斯", "采样"]
  },
  {
    name: "电子电路与系统",
    image: "/assets/circuits_island.webp",
    mobileImage: "/assets/circuits_island_mobile.webp",
    board: "circuit",
    description: "从基尔霍夫定律、运放、滤波器和反馈系统进入模拟电路与系统设计。",
    tags: ["电路分析", "运算放大器", "反馈"]
  },
  {
    name: "数字电路",
    image: "/assets/digital_island.webp",
    mobileImage: "/assets/digital_island_mobile.webp",
    board: "circuit",
    description: "用布尔代数、逻辑门、状态机和 Verilog 建模搭建数字系统的思维框架。",
    tags: ["逻辑门", "状态机", "Verilog"]
  }
];

const track = document.getElementById("study-world-track");
const searchForm = document.getElementById("world-search-form");
const searchInput = document.getElementById("world-search-input");
const scrollButtons = Array.from(document.querySelectorAll("[data-world-scroll]"));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function discussionHref(board) {
  return `/discussion?board=${encodeURIComponent(board)}`;
}

function renderStudyWorlds() {
  if (!track) return;

  track.innerHTML = studyWorlds
    .map((world) => {
      const tags = world.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
      return `
        <article class="study-world-card">
          <picture class="study-world-media">
            <source srcset="${escapeHtml(world.mobileImage)}" media="(max-width: 720px)" />
            <img src="${escapeHtml(world.image)}" alt="${escapeHtml(world.name)}" loading="lazy" />
          </picture>
          <div class="study-world-copy">
            <p class="study-world-label">学习世界</p>
            <h2>${escapeHtml(world.name)}</h2>
            <p>${escapeHtml(world.description)}</p>
            <div class="study-world-tags" aria-label="${escapeHtml(world.name)}知识点">
              ${tags}
            </div>
          </div>
          <div class="study-world-actions">
            <button class="study-world-action study-world-action-disabled" type="button" disabled>进入学习</button>
            <a class="study-world-action study-world-action-discuss" href="${discussionHref(world.board)}">进入讨论</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function scrollWorld(direction) {
  if (!track) return;
  const amount = Math.max(track.clientWidth * 0.82, 280);
  track.scrollBy({ left: amount * direction, behavior: "smooth" });
}

function scrollToWorld(query) {
  if (!track || !query) return;

  const normalizedQuery = query.trim().toLowerCase();
  const index = studyWorlds.findIndex((world) => {
    const searchable = [world.name, world.description, ...world.tags].join(" ").toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  const card = track.querySelectorAll(".study-world-card")[index];
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

scrollButtons.forEach((button) => {
  button.addEventListener("click", () => {
    scrollWorld(Number(button.dataset.worldScroll || 1));
  });
});

renderStudyWorlds();

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  scrollToWorld(searchInput?.value || "");
});

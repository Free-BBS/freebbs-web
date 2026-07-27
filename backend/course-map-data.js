const COURSE_SEEDS = [
  {
    slug: 'math',
    name: '数理基础',
    code: 'Mathematical Foundations',
    boardSlug: 'math',
    description: '从微积分、线性代数、复指数到概率统计，建立电子信息课程需要的数学基础。',
    summary: '用一张可探索的地图串联数理工具、典型结论与后续课程中的应用。',
    sortOrder: 10,
  },
  {
    slug: 'signals',
    name: '信号系统',
    code: 'Signals and Systems',
    boardSlug: 'signal',
    description: '从信号描述、线性时不变系统到傅里叶分析和采样定理，建立时域与频域之间的基本语言。',
    summary: '先描述信号，再描述系统如何改变信号，最后用频域工具看清结构。',
    sortOrder: 20,
  },
  {
    slug: 'circuits',
    name: '电子电路与系统',
    code: 'Electronic Circuits and Systems',
    boardSlug: 'circuit',
    description: '从基本定律、运算放大器、滤波器到反馈系统，逐步进入模拟电路与系统设计。',
    summary: '沿着器件、单元电路和系统分析三条线建立电路设计知识网络。',
    sortOrder: 30,
  },
  {
    slug: 'digital',
    name: '数字电路',
    code: 'Digital Logic',
    boardSlug: 'circuit',
    description: '用布尔代数、逻辑门、有限状态机与 Verilog 建模，搭建数字系统设计思维。',
    summary: '从组合逻辑出发，进入时序系统、状态机与硬件描述语言。',
    sortOrder: 40,
  },
];

const SIGNAL_NODE_SEEDS = [
  {
    nodeId: 'SS-01-01',
    title: '信号分类与基本运算',
    summary: '理解连续/离散、周期/非周期、能量/功率信号，并掌握平移、反褶和尺度变换。',
    x: 120,
    y: 260,
    markdown: String.raw`# 信号分类与基本运算

信号系统课的第一步是建立描述对象的语言。连续时间信号写作 $x(t)$，离散时间信号写作 $x[n]$。

## 周期性

$$
x(t + T) = x(t), \qquad x[n + N] = x[n]
$$

其中 $T>0$ 是连续时间周期，$N$ 是正整数周期。

## 基本变换

- $x(t-t_0)$：向右平移 $t_0$；
- $x(-t)$：关于纵轴反褶；
- $x(at)$：$|a|>1$ 时压缩，$0<|a|<1$ 时拉伸。

连续时间信号的能量定义为

$$
E=\int_{-\infty}^{\infty}|x(t)|^2\,dt.
$$`,
  },
  {
    nodeId: 'SS-02-01',
    title: 'LTI 系统与卷积',
    summary: '用线性、时不变和冲激响应统一描述系统的输入输出关系。',
    x: 430,
    y: 120,
    markdown: String.raw`# LTI 系统与卷积

LTI 是 linear time-invariant，即线性时不变系统。只要知道系统对单位冲激的响应 $h(t)$，就能得到任意输入的响应：

$$
y(t)=\int_{-\infty}^{\infty}x(\tau)h(t-\tau)\,d\tau=x(t)*h(t).
$$

卷积表达的是：输入在每个时刻贡献一个缩放后的冲激响应，当前输出是所有贡献之和。`,
  },
  {
    nodeId: 'SS-03-01',
    title: '傅里叶级数',
    summary: '把周期信号拆成复指数基函数的加权和，理解频谱线和系数含义。',
    x: 740,
    y: 120,
    markdown: String.raw`# 傅里叶级数

周期为 $T_0$ 的信号，其基波角频率是

$$
\omega_0=\frac{2\pi}{T_0}.
$$

傅里叶级数将周期信号写成复指数的加权和：

$$
x(t)=\sum_{k=-\infty}^{\infty}a_ke^{jk\omega_0t}.
$$

$a_k$ 表示频率 $k\omega_0$ 成分的强度和相位。`,
  },
  {
    nodeId: 'SS-04-01',
    title: '傅里叶变换',
    summary: '把非周期信号表示成连续频率上的复指数叠加，连接时域与频域。',
    x: 740,
    y: 410,
    markdown: String.raw`# 傅里叶变换

傅里叶变换与反变换为

$$
X(j\omega)=\int_{-\infty}^{\infty}x(t)e^{-j\omega t}\,dt,
$$

$$
x(t)=\frac{1}{2\pi}\int_{-\infty}^{\infty}X(j\omega)e^{j\omega t}\,d\omega.
$$

对 LTI 系统，时域卷积在频域变成乘法：

$$
y(t)=x(t)*h(t)\Longleftrightarrow Y(j\omega)=X(j\omega)H(j\omega).
$$`,
  },
  {
    nodeId: 'SS-05-01',
    title: '采样定理',
    summary: '理解采样后的频谱复制、混叠条件，以及采样率为什么必须足够高。',
    x: 1050,
    y: 260,
    markdown: String.raw`# 采样定理

理想采样把连续信号与冲激串相乘。采样会让原信号频谱以采样角频率 $\omega_s$ 为间隔重复复制。

若原信号最高角频率为 $\omega_m$，为了避免混叠，需要

$$
\omega_s>2\omega_m.
$$

工程系统通常在采样前加入抗混叠低通滤波器。`,
  },
];

const SIGNAL_EDGE_SEEDS = [
  ['SS-01-01', 'SS-02-01', 'ordered'],
  ['SS-02-01', 'SS-03-01', 'ordered'],
  ['SS-03-01', 'SS-04-01', 'ordered'],
  ['SS-04-01', 'SS-05-01', 'ordered'],
  ['SS-02-01', 'SS-04-01', 'related'],
];

module.exports = {
  COURSE_SEEDS,
  SIGNAL_EDGE_SEEDS,
  SIGNAL_NODE_SEEDS,
};

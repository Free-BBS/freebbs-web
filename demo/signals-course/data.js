window.DEMO_COURSE_DATA = {
  slug: 'signals',
  name: '信号系统',
  code: 'Signals and Systems',
  board: 'signal',
  term: '单课程知识点页 Demo',
  description: '从信号描述、线性时不变系统到傅里叶分析和采样定理，建立时域与频域之间的基本语言。',
  summary: '这门课的主线是：先描述信号，再描述系统如何改变信号，最后用频域工具看清结构。',
  points: [
    {
      id: 'signal-basics',
      title: '信号分类与基本运算',
      summary: '理解连续/离散、周期/非周期、能量/功率信号，并掌握平移、反褶、尺度变换等基本操作。',
      tags: ['信号表示', '基本运算', '周期性'],
      prerequisites: [],
      resources: [
        {
          type: '讲义',
          title: '课程讲义：信号的描述',
          description: '适合先看定义、例子和常见信号图像。',
        },
        {
          type: '练习',
          title: '基础图像变换题',
          description: '重点练习时间平移、尺度变换和反褶的先后顺序。',
        },
      ],
      bodyMarkdown: `
## 为什么要先分类信号

信号系统课不是先背公式，而是先建立“对象语言”。同一个函数在不同问题里可能扮演完全不同的角色，所以我们先问：自变量是连续时间 $t$ 还是离散时间 $n$？信号是否周期重复？能量或平均功率是否有限？

连续时间信号写作 $x(t)$，离散时间信号写作 $x[n]$。周期性的定义也随对象变化：

$$
x(t+T)=x(t), \\qquad x[n+N]=x[n]
$$

## 基本运算的顺序

看到 $x(at-b)$ 时，建议先把括号改写成 $x(a(t-b/a))$。这样可以直接读出两件事：先围绕时间轴做尺度变换，再看平移量。

- $x(t-t_0)$：向右平移 $t_0$。
- $x(-t)$：关于纵轴反褶。
- $|a|>1$ 时压缩；$0<|a|<1$ 时拉伸。

## 能量与功率

有限能量信号通常是“短暂出现”的信号；有限功率信号通常可以长期存在，例如周期信号。

$$
E=\\int_{-\\infty}^{\\infty}|x(t)|^2\\,dt,
\\qquad
P=\\lim_{T\\to\\infty}\\frac{1}{2T}\\int_{-T}^{T}|x(t)|^2\\,dt
$$
      `,
    },
    {
      id: 'lti-system',
      title: 'LTI 系统与卷积',
      summary: '把系统分成线性、时不变两条性质，用冲激响应和卷积统一描述输入输出关系。',
      tags: ['线性', '时不变', '卷积'],
      prerequisites: ['signal-basics'],
      resources: [
        {
          type: '讲义',
          title: '课程讲义：LTI 系统',
          description: '建议重点看冲激响应如何刻画整个系统。',
        },
        {
          type: '讨论',
          title: '卷积几何直觉',
          description: '把卷积看成翻转、平移、相乘、积分的过程。',
        },
      ],
      bodyMarkdown: `
## LTI 的核心想法

LTI 是 linear time-invariant，也就是线性时不变系统。它看起来是两个条件，实际带来一个非常强的结论：只要知道系统对单位冲激的响应，就知道系统对任意输入的响应。

线性要求系统满足叠加性：

$$
\\mathcal{T}\\{a x_1(t)+b x_2(t)\\}
=a\\mathcal{T}\\{x_1(t)\\}+b\\mathcal{T}\\{x_2(t)\\}
$$

## 冲激响应与卷积

设系统对单位冲激 $\\delta(t)$ 的响应是 $h(t)$。任意输入都可以看成很多被加权、被平移的冲激叠加；由于线性和时不变，输出就是这些响应的叠加。

$$
y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)h(t-\\tau)\\,d\\tau=x(t)*h(t)
$$

## 怎么读卷积

卷积不是凭空来的乘积公式。它表达的是：输入在每个时刻贡献一个缩放后的冲激响应，当前输出是所有贡献相加。

读卷积时可以按四步走：**翻转、平移、相乘、积分**。这比直接背公式更稳。
      `,
    },
    {
      id: 'fourier-series',
      title: '傅里叶级数',
      summary: '把周期信号拆成复指数基函数的加权和，理解频谱线、基波频率和系数含义。',
      tags: ['周期信号', '复指数', '频谱线'],
      prerequisites: ['signal-basics', 'lti-system'],
      resources: [
        {
          type: '讲义',
          title: '课程讲义：周期信号的频域表示',
          description: '先理解复指数正交性，再看系数公式。',
        },
        {
          type: '练习',
          title: '方波与三角波展开',
          description: '用典型波形观察奇偶性如何简化计算。',
        },
      ],
      bodyMarkdown: `
## 从周期性到离散频率

如果 $x(t)$ 是周期为 $T_0$ 的周期信号，它的基波角频率是：

$$
\\omega_0=\\frac{2\\pi}{T_0}
$$

傅里叶级数说的是：很多周期信号都可以写成一串复指数的加权和。

$$
x(t)=\\sum_{k=-\\infty}^{\\infty}a_k e^{jk\\omega_0t}
$$

## 系数公式从哪里来

复指数在一个周期内具有正交性。把 $x(t)$ 的展开式两边同乘 $e^{-jm\\omega_0t}$，并在一个周期内积分，只剩下第 $m$ 项。

$$
a_m=\\frac{1}{T_0}\\int_{T_0}x(t)e^{-jm\\omega_0t}\\,dt
$$

## 物理含义

$a_k$ 表示信号中频率 $k\\omega_0$ 这一成分的强度和相位。频域表示的好处是：很多系统对复指数输入只会改变幅度和相位。
      `,
    },
    {
      id: 'fourier-transform',
      title: '傅里叶变换',
      summary: '把非周期信号表示成连续频率上的复指数叠加，连接时域形状与频域分布。',
      tags: ['非周期信号', '频域', '系统响应'],
      prerequisites: ['fourier-series'],
      resources: [
        {
          type: '讲义',
          title: '课程讲义：傅里叶变换性质',
          description: '重点整理线性、时移、频移、尺度、卷积性质。',
        },
        {
          type: '讨论',
          title: '傅里叶变换常见困惑',
          description: '适合把推导卡点发到信号板块继续讨论。',
        },
      ],
      bodyMarkdown: `
## 从级数到变换

傅里叶级数处理周期信号。非周期信号可以看成周期越来越长的极限：当周期 $T_0$ 变大，基波间隔变小，原来一根根离散谱线逐渐变成连续频率轴。

傅里叶变换定义为：

$$
X(j\\omega)=\\int_{-\\infty}^{\\infty}x(t)e^{-j\\omega t}\\,dt
$$

反变换把频域重新合成为时域：

$$
x(t)=\\frac{1}{2\\pi}\\int_{-\\infty}^{\\infty}X(j\\omega)e^{j\\omega t}\\,d\\omega
$$

## 频域不是另一个世界

时域问“信号什么时候发生、形状怎样”；频域问“这个形状由哪些振荡成分组成”。窄脉冲需要很多高频成分来拼出快速变化。

## 与 LTI 系统的关系

对 LTI 系统，卷积在频域里变成乘法。这就是频域方法强大的原因：时域卷积可能很麻烦，频域乘法通常更直接。

$$
y(t)=x(t)*h(t)
\\qquad \\Longleftrightarrow \\qquad
Y(j\\omega)=X(j\\omega)H(j\\omega)
$$
      `,
    },
    {
      id: 'sampling-theorem',
      title: '采样定理',
      summary: '理解连续信号采样后的频谱复制、混叠条件，以及为什么采样率必须足够高。',
      tags: ['采样', '混叠', '奈奎斯特'],
      prerequisites: ['fourier-transform'],
      resources: [
        {
          type: '讲义',
          title: '课程讲义：采样与重建',
          description: '重点看冲激串采样在频域中的复制效果。',
        },
        {
          type: '练习',
          title: '采样率判断题',
          description: '判断最高频率、奈奎斯特频率和是否混叠。',
        },
      ],
      bodyMarkdown: `
## 采样到底做了什么

理想采样可以写成连续信号乘以冲激串。时域相乘对应频域卷积，所以采样会让原信号频谱以采样角频率为间隔重复复制。

$$
x_s(t)=x(t)\\sum_{n=-\\infty}^{\\infty}\\delta(t-nT_s),
\\qquad
\\omega_s=\\frac{2\\pi}{T_s}
$$

## 不混叠的条件

如果原信号最高角频率为 $\\omega_m$，为了复制后的频谱不互相重叠，需要采样角频率大于两倍最高角频率：

$$
\\omega_s>2\\omega_m
$$

## 为什么混叠很危险

一旦频谱复制发生重叠，高频成分会伪装成低频成分。重建滤波器无法知道它原来属于哪里，所以失真不可逆。
      `,
    },
  ],
};

/**
 * 学生联络中心 FREE BBS 展示页 V4 · 内容与素材配置
 * 请优先修改这里，而不是修改页面结构或样式。
 * 所有照片均为工作示意图；用实际照片替换 assets 路径即可。
 * work[].details 负责工作弹窗要点，work[].photo 负责该弹窗图片。
 * gallery[].images 数组有几项，相册就有几张，数量不限。
 */
window.LC_CONTENT = {
  identity: {
    name: '学生联络中心',
    organization: '清华大学电子工程系学生会',
    english: 'STUDENT LIAISON CENTER',
  },
  hero: {
    eyebrow: '连接校园内外 · 让协作自然发生',
    titleFirst: '学生联络中心',
    titleSecond: '让联结，成为更多可能。',
    description: '对内协调组织、服务同学；对外联络企业、拓展合作。我们在一次次沟通与相聚中，把想法变成活动，把资源带给大家。',
    cover: 'assets/破冰合照1.jpg',
    coverAlt: '学生联络中心活动合照',
    coverNote: '学生联络中心 · 活动合照',
  },
  about: {
    title: '一座桥，连接两种方向。',
    intro: '学生联络中心既是学生会内部高效协作的纽带，也是电子系与校外企业交流合作的窗口。',
    innerTitle: '让组织运转得更好',
    innerDesc: '对内保证学生会各部门间的联络、建设及协调，服务同学的在校生活，让合作顺畅、活动落地。',
    outerTitle: '让校园拥有更多可能',
    outerDesc: '对外寻求与公司、企业的交流与合作，为电子系各大活动和赛事争取资源、创造机会。',
    innerKeywords: ['班级对接', '跨部门协作', '毕业生服务', '内部建设'],
    outerKeywords: ['校企交流', '名企微体验', '企业赞助'],
  },
  work: [
    {
      number:'01', type:'inner', category:'新生服务', icon:'users',
      title:'新生班级对接',
      text:'为每个新生班级安排负责同学对接班长，建立沟通渠道，协助信息传递与需求反馈。',
      footnote:'从入学开始，保持联络',
      details:['为每个新生班级安排联络负责人，与班长建立稳定对接关系。','及时同步活动和相关信息，收集并反馈新生班级的需求。','在班级、同学和学生会之间搭建通畅的沟通渠道。'],
      photo:'assets/新生班级对接.svg', photoAlt:'新生班级对接相关照片',
      photoCaption:' ',
    },
    {
      number:'02', type:'outer', category:'行业探索', icon:'building',
      title:'名企微体验',
      text:'面向新生组织名企微体验，沟通企业与活动安排，让同学们有机会近距离了解行业。',
      footnote:'走进企业，看见更广阔的世界',
      details:['联系参访企业，沟通活动时间、流程及注意事项。','组织新生报名、活动通知与行程安排。','帮助同学们走近行业一线，拓展对专业与职业发展的认识。'],
      photo:'assets/名企1.jpg', photoAlt:'名企微体验活动照片',
      photoCaption:' ',
    },
    {
      number:'03', type:'outer', category:'校企合作', icon:'handshake',
      title:'企业合作与赞助',
      text:'联络校外公司与企业，沟通合作资源，为学生节等系内大型活动争取赞助与支持。',
      footnote:'让好想法拥有实现的资源',
      details:['与企业和合作伙伴建立联系、沟通合作意向。','为学生节以及其他系内活动和赛事争取适合的赞助与资源。','协调学生组织与企业之间的需求，跟进合作落地。'],
      photo:'assets/企业合作与赞助.svg', photoAlt:'企业合作与赞助照片',
      photoCaption:' ',
    },
    {
      number:'04', type:'inner', category:'活动共创', icon:'spark',
      title:'校园活动与路演',
      text:'与其他学生组织、部门协作，参与举办新生舞会、毕业游园会、学生节等活动，并组织学生节路演。',
      footnote:'一起让活动真正发生',
      details:['与学生会其他部门、学生组织协同筹备新生舞会、毕业游园会等活动。','参与学生节等系内大型活动的沟通与执行协调。','组织学生节路演，联系相关参与方，推进现场活动顺利开展。'],
      photo:'assets/活动.jpg', photoAlt:'校园活动与路演照片',
      photoCaption:' ',
    },
    {
      number:'05', type:'inner', category:'毕业季', icon:'graduation',
      title:'毕业生专属服务',
      text:'联系摄影师团购、组织二手交易平台，为毕业季提供更贴心、更实用的服务。',
      footnote:'让毕业季留下更多美好',
      details:['联系毕业摄影师与团购服务，为毕业生提供更多便利。','筹备毕业季二手交易平台，促进闲置物品有序流转。','关注毕业生实际需求，协调落实可用的服务资源。'],
      photo:'assets/毕业生专属服务.svg', photoAlt:'毕业生服务照片',
      photoCaption:' ',
    },
    {
      number:'06', type:'inner', category:'组织建设', icon:'compass',
      title:'内联与出游实践',
      text:'促进学生会内部联络和部门建设，协调日常合作，并组织出游实践等团队活动。',
      footnote:'在一起做事，也在一起成长',
      details:['推动学生会部门之间的信息沟通、联络与协调。','参与学生会日常建设，为跨部门合作提供支持。','组织部门团建、出游与实践，在共同经历中凝聚团队。'],
      photo:'assets/内联.png.webp', photoAlt:'内联与出游实践照片',
      photoCaption:' ',
    },
  ],
  gallery: [
    {
      number:'01', category:'活动共创', title:'学生节 · 路演与协作',
      images:[
        {src:'assets/学生节合照.png.webp', alt:'学生节照片一', caption:'“掠影”学生节联络中心合照'},
        {src:'assets/路演.png.webp', alt:'学生节照片二', caption:'学生节路演合照'},
        {src:'assets/学生节.jpg', alt:'学生节照片三', caption:'“无字诗”学生节工作人员合照'},
      ],
    },
    {
      number:'02', category:'行业探索', title:'名企微体验',
      images:[
        {src:'assets/名企1.jpg', alt:'名企微体验照片一', caption:'五字班同学赴无问芯穹参观'},
        {src:'assets/名企2.jpg', alt:'名企微体验照片二', caption:'企业参访合影'},
      ],
    },
    {
      number:'03', category:'青春相聚', title:'新生舞会 / 毕业游园会',
      images:[
        {src:'assets/舞会茶歇.png.webp', alt:'舞会与毕业活动照片一', caption:'新生舞会活动现场'},
        {src:'assets/毕业游园会合照1.png.webp', alt:'舞会与毕业活动照片二', caption:'毕业游园会合照'},
          { src: 'assets/毕业游园会合照.png.webp', alt: '舞会与毕业活动照片三', caption: '毕业游园会现场' },
          { src: 'assets/新生舞会合照1.png.webp', alt: '舞会与毕业活动照片三', caption: '新生舞会合照（电子系）' },
          { src: 'assets/新生舞会合照2.png.webp', alt: '舞会与毕业活动照片三', caption: '新生舞会合照（联络中心）' },
      ],
    },
    {
      number:'04', category:'中心日常', title:'内联与出游实践',
      images:[
        {src:'assets/秦皇岛合照.png.webp', alt:'中心日常照片一', caption:'部门赴秦皇岛实践合照'},
        {src:'assets/海底捞合照.png.webp', alt:'中心日常照片二', caption:'部门聚餐合照'},
          { src: 'assets/秦皇岛红色足迹1.png.webp', alt: '中心日常照片三', caption: '部门实践集体合影' },
          { src: 'assets/内联.png.webp', alt: '舞会与毕业活动照片三', caption: '部门外出实践' },
          { src: 'assets/秦皇岛红色足迹2.png.webp', alt: '舞会与毕业活动照片三', caption: '部门实践集体合影' },
      ],
    },
  ],
  closing: {
    title:'加入联络，\n让更多可能发生。',
    description:'如果你热爱交流，喜欢把创意落到实处；如果你期待认识志同道合的伙伴，在合作中探索更大的世界——欢迎加入学生联络中心。',
    benefits:['更自然自信的沟通与协作能力','从策划到落地的项目实践经验','接触企业、拓展视野的机会','一群一起做事、一起成长的伙伴'],
  },
  contact: {
    // 必填：请于提交前替换成真实负责同学邮箱或公共邮箱。
    email:'chenyu-w24@mails.tsinghua.edu.cn',
    label:'联络中心主任 王晨羽',
  },
};

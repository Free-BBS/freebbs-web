-- Preserve existing slugs/IDs and their posts/moderators; split out new subjects.
INSERT INTO discussion_boards (slug, name, description, description_markdown, sort_order, is_active)
VALUES
 ('daily', '日常', '生活、课程与校园碎碎念', '生活、课程与校园碎碎念。可以分享日常、提问、吐槽和轻量讨论。', 10, 1),
 ('math', '数学', '数学知识、方法与推导讨论', '数学知识、方法与推导讨论，支持 Markdown 与 KaTeX。原数理分区的帖子保留在这里。', 20, 1),
 ('physics', '物理', '物理概念、现象与模型讨论', '从物理现象出发，交流概念理解、模型和推导过程。', 30, 1),
 ('circuit', '电路', '模电、数电与硬件实现', '模电、数电与硬件实现相关内容。建议附上电路图、波形、公式或关键参数。', 40, 1),
 ('signal', '信号', '信号、系统与通信方向讨论', '信号、系统与通信方向讨论。可以贴推导、代码、仿真结果和参考资料。', 50, 1),
 ('computer', '计算机', '编程、算法与计算机系统', '交流编程思路、算法、计算机系统和工具使用，分享排错过程。', 60, 1),
 ('experiment', '实验', '实验设计、测量与实践记录', '分享实验设计、测量方法、结果分析与实践经验。', 70, 1),
 ('changelog', '更新日志', '站点更新、修复与版本记录', 'FREE-BBS 的站点更新、修复与版本记录。这里用于同步功能变化和维护信息。', 80, 1)
ON DUPLICATE KEY UPDATE
 name = VALUES(name), description = VALUES(description),
 description_markdown = COALESCE(discussion_boards.description_markdown, VALUES(description_markdown)),
 sort_order = VALUES(sort_order), is_active = VALUES(is_active);

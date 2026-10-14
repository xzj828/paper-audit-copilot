# 有限英文追问与草稿

识别continue、go on、tell me more、explain more/further、elaborate、can/could you elaborate、why、why is that。支持please前缀、大小写、句末问号/感叹号/句号。现有中文短追问保留，允许中英混合。必须整句匹配；tell me more about temperature、why does temperature change等完整新主题问题不继承。

仅检查当前版本最近三次有文字的用户问题，倒序寻找最近明确主题；跳过已识别追问，不采用助手内容。超过窗口、无历史或只有助手内容时不借用旧主题。属于有限词法规则，不能保证理解任意英语指代或多轮对话。

每次新检索记录followUpPolicy=bounded-follow-up@1，followUpTo标明被沿用的用户问题ID，queryText保存实际查询。原提交问题仍单独保存。原BM25排序及术语映射版本不变。JSON继续paper-audit-chat@2，仅新增可选字段；Markdown显示追问策略，旧记录缺失不补造。

首条响应到达时，仅在输入仍等于已发送原文时清空；已输入的不同下一条草稿保留，不自动发送。比较的是文字，不能识别用户编辑后又写回完全相同文字的输入意图。

两项Node固定开发控制覆盖9种英文写法、5种新主题反例、三轮窗口、混合语言、无用户历史、输入不变及导出。原实现2/2失败后修复。两项浏览器验证真实合成DOCX上传、英文追问、手机刷新后切回对话、新主题与随后why的查询归属、JSON/Markdown及历史消息/解析保留；另一项控制响应延迟并验证不同草稿保留。首轮浏览器等待流式占位引发草稿覆盖，修复并改等待保存完成；随后漏切手机对话页已补齐。一个提前开始的全量运行主动中止，退出130，保留记录。

最终目标2项浏览器及完整生产构建、245项Node、58项浏览器通过。无外部模型调用，没有真实用户评测、专家标注或通用英文理解准确率；历史检索评测保留原标签与指纹。当前证明见english-followups-validation.json。

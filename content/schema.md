# 内容数据规范（供内容生产使用，代码按此契约读取）

所有文件均为 UTF-8 JSON，禁止注释、禁止尾随逗号。中文使用全角标点，英文与数字前后不加空格（除专有名词）。

## 1. content/personas.json
数组，固定 3 项，顺序：peer、senior、manager。

```json
{
  "id": "peer",
  "name": "同级面试官",
  "subtitle": "未来同事 · 平等对话",
  "tagline": "像同事一样聊，重点看协作与潜力",
  "description": "80-120 字，说明这位面试官是谁、关心什么、提问风格。",
  "tone": "提问语气描述，如：轻松、爱追问细节、会给提示",
  "focus": ["协作沟通", "学习能力", "技术判断"],
  "questionStyle": "提问风格一句话",
  "color": "#8b5cf6",
  "opening": "开场白模板，可含 {name}、{role} 占位符",
  "closing": "结束语模板，可含 {name} 占位符",
  "systemHint": "给 LLM 的人格提示词片段，80-150 字，第二人称"
}
```

## 2. content/roles.json
数组，6 个岗位包，id 使用英文短横线。

```json
{
  "id": "ai-product-manager",
  "name": "AI 产品经理",
  "aliases": ["AI PM", "人工智能产品经理", "大模型产品经理"],
  "summary": "一句话岗位画像",
  "keywords": ["Agent", "RAG", "Prompt", "评测", "..."],
  "competencies": [
    { "name": "产品洞察", "weight": 0.25, "desc": "…" },
    { "name": "AI 技术理解", "weight": 0.25, "desc": "…" },
    { "name": "项目推进", "weight": 0.2, "desc": "…" },
    { "name": "数据与实验", "weight": 0.15, "desc": "…" },
    { "name": "沟通表达", "weight": 0.15, "desc": "…" }
  ],
  "focusTopics": ["大模型能力边界", "Agent 工作流", "RAG 与幻觉治理", "..."],
  "screeningQuestions": ["4-6 个该岗位高频初筛题"],
  "redFlags": ["3-5 条该岗位面试中的减分项"]
}
```
competencies 权重之和必须为 1。

## 3. content/questions/*.json
每个文件是一个数组，按类别分文件：behavior.json、project.json、domain.json、role.json、pressure.json、closing.json。
总计 80-100 题，中文，面向 1-5 年经验的互联网/AI/数据岗位候选人；其中 AI 产品经理、数据产品经理相关题目占比不低于 50%。

```json
{
  "id": "proj-001",
  "text": "完整题干，一句话到两句话，口语化，像真人面试官会问的",
  "category": "项目深挖",
  "role": ["AI 产品经理", "数据产品经理"],
  "level": "初级|中级|高级",
  "persona": ["senior", "manager"],
  "difficulty": 3,
  "intent": "这道题到底在考察什么，30-60 字",
  "tags": ["0-1", "需求判断", "跨部门"],
  "answerPoints": ["4-6 条参考回答要点，每条 15-30 字，具体可核对"],
  "followUps": ["2-3 个真实追问，尖锐但不冒犯"],
  "redFlags": ["1-3 条典型减分回答"],
  "starExample": "可选：一段 120-200 字的示范回答（用候选人视角，第一人称，含具体动作与量化结果）"
}
```
类别取值固定为：行为面试、项目深挖、专业能力、岗位认知、压力面试、反问环节。
persona 取值固定为：peer、senior、manager。

## 4. content/kb/*.json
每个文件是一个数组，共 14-18 篇知识文档，覆盖：回答方法论、AI 产品知识、数据产品知识、面试策略、复盘方法。
单篇 600-1200 字中文 Markdown（content 字段内可用 ## 小标题、列表、表格、代码块）。

```json
{
  "id": "kb-star",
  "title": "STAR 不够用：把经历讲成有决策的故事",
  "category": "回答方法论",
  "tags": ["STAR", "结构化表达", "行为面试"],
  "summary": "60-100 字摘要，会展示在卡片上",
  "content": "Markdown 正文，结构清晰、有例子、可直接用于面试准备",
  "source": "面镜教研组",
  "readingMinutes": 5
}
```
category 取值：回答方法论、AI 产品、数据产品、面试策略、复盘与成长。

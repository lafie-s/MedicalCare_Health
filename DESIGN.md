---
version: alpha
name: MedicalCare Health
description: 中文运行维护工作台，以环境和授权边界组织信息。
colors:
  primary: "#2059c9"
  primary-hover: "#17449f"
  ink: "#192b44"
  muted: "#586a80"
  surface: "#ffffff"
  background: "#f3f6fa"
  border: "#d5deea"
  navy: "#142b49"
  on-navy: "#c5d7ed"
  accent: "#85d7e4"
  danger: "#a52b3b"
  danger-surface: "#fff1f2"
typography:
  sans:
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif'
  display:
    fontFamily: '"Bahnschrift", "Microsoft YaHei", sans-serif'
  mono:
    fontFamily: '"Cascadia Code", Consolas, monospace'
rounded:
  sm: "6px"
  md: "12px"
spacing:
  section-gap: "32px"
  page-max: "1200px"
components:
  button: {}
  notice: {}
  field: {}
---

# MedicalCare Health Design System

## Overview

面向 MedicalCareWeb 运维人员的产品界面，默认简体中文、桌面值守场景，兼顾手机查看。当前用户未指定地区市场业务规则；本项目不处理患者数据。

视觉参考是机房设备的环境标签与访问面板：深蓝侧栏、白色操作区、固定宽度技术标识。唯一强调是登录页的服务层级示意，以“服务 / 接口 / 依赖”说明监测对象，不伪造实时曲线或在线状态。不要做宣传落地页、霓虹大屏或患者健康仪表盘。

规范值由本文件生成 `web/app/tokens.css`，生成器 `scripts/design-tokens.mjs`；`globals.css` 与共享组件只消费变量。运行 `npm run tokens:check` 检查漂移。当前没有既有 UI 可复用，登录与环境入口作为首批同系页面。

## Colors

primary 用于主操作及当前环境，navy 用于品牌侧栏，accent 仅在深色背景标记层级。muted 是辅助文字，danger 同时配文字提示。仅提供浅色主题，系统强制颜色模式保留原生可辨识边界。

## Typography

正文与控件 16px，辅助信息 14px，标题 28–36px。中文正文至少 1.6 行高；技术 ID 使用 mono，标题 display。使用系统字体避免网络字体闪动，名称允许换行而非丢失内容。

## Layout

登录页左侧占 44%，右侧表单最大 400px；840px 以下纵向排列。工作台使用 240px 侧栏及自然滚动内容区，840px 以下侧栏改为顶部。页面最大宽度 page-max；间距以 8px 步进，表单错误和忙碌按钮保留位置。

## Elevation & Depth

静态面板依靠边框与底色分层，不使用浮动卡片阴影。错误提示始终留在对应操作附近。

## Shapes

sm 用于按钮和输入，md 用于内容面板，环境列表为整行选择。品牌图形以三条不同长度线段表示服务层级，不使用医学十字暗示医疗能力。

## Components

`web/components/ui.tsx` 拥有 Button、Notice、Brand。Button 区分 primary/neutral，固定最小高度 44px，busy 只替换可见文字并禁用。Notice 拥有成功、错误和加载信息的文本反馈。输入表单保留 label、aria-invalid、aria-describedby 和首错焦点。

全局滚动条由 globals.css 控制：border 为 thumb，background 为 track，muted 为 hover，primary 为 active。页面可自然滚动，禁止隐藏滚动条。交互有 hover、focus-visible、active、disabled；动效仅用于颜色过渡，reduced-motion 关闭。

环境数据以最多 100 项的授权列表完整显示（API 配置上限），选择保存到 URL 的 environment 参数；无权限时清除失效选择。服务目录也有每环境 100 项硬上限，按纵向列表展示。当前没有日期输入、表格、删除操作或 toast。

服务表单的目标与间隔使用原生 select，接受系统提供的弹层样式和键盘交互；表面边框、字色、焦点与 input 一致。共享 Dialog 使用原生 dialog 模态能力，宽度不超过 520px、距离视口边缘至少 16px、内容可滚动；暗色遮罩仅服务于模态层级。保存按钮与错误反馈复用 Button、Notice。

## Do's and Don'ts

- 显示授权环境、真实身份和数据缺失原因。
- 会话失效后清除受保护内容，再给出重新登录入口。
- 不把尚未接入的指标显示为 0 或正常。
- 不添加尚无后端能力的导航按钮。

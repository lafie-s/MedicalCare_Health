"use client";
import { useEffect, useRef, useState } from "react";
import type { ProbeTrend, TrendBucket } from "../../src/probe-trend";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
import type { Service } from "./service-panel";
type Trend = ProbeTrend & { targetAvailable: boolean; enabled: boolean };
const formatTime = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);

export function TrendDialog({ service, onClose, onUnauthorized }: { service: Service; onClose: () => void; onUnauthorized: () => void }) {
  const [hours, setHours] = useState("1");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Trend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setData(null); setError("");
    void api<Trend>(`/services/${service.id}/trend?hours=${hours}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setData(result); }).catch((err) => {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current();
      else setError(err instanceof Error ? err.message : "趋势查询失败，请重试");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [service.id, hours, revision]);
  return <Dialog title={`${service.name} · 探测趋势`} onCancel={onClose}>
    <div className="trend-controls"><div><label htmlFor="trend-hours">时间范围</label><select autoFocus id="trend-hours" value={hours} onChange={(event) => setHours(event.target.value)}><option value="1">最近 1 小时</option><option value="6">最近 6 小时</option><option value="24">最近 24 小时</option></select></div><Button busy={loading} onClick={() => setRevision((value) => value + 1)}>刷新趋势</Button></div>
    <div className="trend-content" aria-busy={loading}>{loading ? <Notice>正在查询探测趋势…</Notice> : error ? <Notice error>{error}</Notice> : data && <>
      {!data.targetAvailable && <Notice>目标授权已撤销，当前配置无可展示样本。</Notice>}{!data.enabled && <Notice>服务已停用，历史结果不代表当前运行状态。</Notice>}
      <p className="trend-caption">北京时间 {formatTime(data.start)} 至 {formatTime(data.end)} · 每 {data.bucketSeconds / 60} 分钟汇总 · 配置版本 {data.serviceVersion}</p>
      <p className="trend-caption">最近有效采样：{data.lastSampleAt === null ? "尚无样本" : formatTime(data.lastSampleAt)}。这是查询时的历史快照，点击刷新获取新结果。</p>
      {!data.points.some((point) => point.samples) && <Notice>所选时间内没有当前配置的有效探测样本。</Notice>}
      <TrendChart points={data.points} field="averageLatencyMs" title="平均响应头耗时" unit="ms" />
      <TrendChart points={data.points} field="availabilityPercent" title="探测成功率" unit="%" />
      <p className="trend-caption">空白表示无数据；耗时只统计收到响应头的请求，不是业务耗时或 P95。超时和连接失败计入成功率，中断不计入。仅展示当前配置版本及目标的样本。</p>
      <details className="trend-details"><summary>查看分段数据（{data.points.length} 段）</summary><div className="trend-table-scroll" tabIndex={0} role="region" aria-label="探测分段数据"><table><caption>时间区间为左开右闭，均为北京时间</caption><thead><tr><th scope="col">区间</th><th scope="col">有效 / 中断</th><th scope="col">耗时样本</th><th scope="col">平均 ms</th><th scope="col">成功率</th></tr></thead><tbody>{data.points.map((point) => <tr key={point.start}><th scope="row">{formatTime(point.start)}<br />至 {formatTime(point.end)}</th><td>{point.samples} / {point.interrupted}</td><td>{point.latencySamples}</td><td>{point.averageLatencyMs ?? "—"}</td><td>{point.availabilityPercent === null ? "—" : `${point.availabilityPercent}%`}</td></tr>)}</tbody></table></div></details>
    </>}</div><div className="dialog-actions"><Button onClick={onClose}>关闭趋势</Button></div>
  </Dialog>;
}

function TrendChart({ points, field, title, unit }: { points: TrendBucket[]; field: "averageLatencyMs" | "availabilityPercent"; title: string; unit: string }) {
  const maximum = field === "availabilityPercent" ? 100 : Math.max(1, ...points.map((point) => point[field] ?? 0));
  let path = ""; let connected = false;
  const dots: { x: number; y: number }[] = [];
  points.forEach((point, index) => {
    const value = point[field]; if (value === null) { connected = false; return; }
    const x = 40 + (index + 0.5) / points.length * 380; const y = 120 - value / maximum * 90;
    path += `${connected ? "L" : "M"}${x},${y} `; connected = true; dots.push({ x, y });
  });
  return <figure className="trend-chart"><figcaption>{title} · {unit}</figcaption><svg viewBox="0 0 440 150" role="img" aria-label={`${title}趋势；精确值及无数据区间见分段数据`}><text x="0" y="30">{maximum}</text><text x="20" y="123">0</text><path className="trend-axis" d="M40 25V120H425" /><path className="trend-line" d={path} />{dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="2.5" />)}<text x="40" y="145">窗口开始</text><text x="355" y="145">窗口结束</text></svg></figure>;
}

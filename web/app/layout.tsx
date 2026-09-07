import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "运维工作台 · MedicalCare Health", description: "MedicalCareWeb 运行指标监测及维护平台", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

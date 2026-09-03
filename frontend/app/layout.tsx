import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hk-study-action-desk.netlify.app"),
  title: {
    default: "留港行动台｜AI 留学管家",
    template: "%s｜留港行动台",
  },
  description: "把合成学校邮件变成有依据的简体中文行动卡",
  keywords: ["留学", "香港", "学校邮件", "行动中心", "合成数据"],
  openGraph: {
    title: "留港行动台",
    description: "把学校邮件变成今天可以执行的下一步。",
    locale: "zh_CN",
    type: "website",
  },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

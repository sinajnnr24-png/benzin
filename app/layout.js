import "./globals.css";

export const metadata = {
  title: "تبدیل فرم سوخت به اکسل",
  description: "عکس فرم دست‌نویس را به فایل اکسل تبدیل کنید",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

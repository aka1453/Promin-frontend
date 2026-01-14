// app/login/layout.tsx

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // IMPORTANT:
  // Do NOT render <html> or <body> here.
  // Root layout (app/layout.tsx) already does that.
  return <>{children}</>;
}

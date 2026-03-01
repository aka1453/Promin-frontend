import { Suspense } from "react";
import LoginUI from "./ui";

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <Suspense>
        <LoginUI />
      </Suspense>
    </div>
  );
}

"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const LoginUI = dynamic(() => import("./ui"), { ssr: false });

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-100 p-8">
      <LoginUI />
    </div>
  );
}

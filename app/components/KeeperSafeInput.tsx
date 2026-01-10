"use client";

import React, { InputHTMLAttributes } from "react";

export default function KeeperSafeInput(
  props: InputHTMLAttributes<HTMLInputElement>
) {
  return (
    <input
      {...props}
      autoComplete="off"
      data-keeper-ignore="true"
      data-keeper-lock-id="0"
      data-lpignore="true"
      data-1p-ignore="true"
    />
  );
}

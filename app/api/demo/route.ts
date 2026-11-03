// Demo Mode のサンプル（1 回目の面談）。続きは /api/demo/2。
import { NextResponse } from "next/server";

import { demoSample } from "./sample";

export async function GET() {
  return NextResponse.json(demoSample(1));
}

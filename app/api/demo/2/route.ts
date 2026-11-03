// Demo Mode のサンプル（続きの面談）。
import { NextResponse } from "next/server";

import { demoSample } from "../sample";

export async function GET() {
  return NextResponse.json(demoSample(2));
}

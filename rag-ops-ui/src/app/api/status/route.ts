import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
    });

    if (!response.ok) {
      return NextResponse.json({ status: 'offline', models: [] }, { status: 503 });
    }

    const data = await response.json();
    return NextResponse.json({
      status: 'online',
      models: data.models || [],
    });
  } catch (error) {
    return NextResponse.json({ status: 'offline', models: [], error: String(error) }, { status: 503 });
  }
}

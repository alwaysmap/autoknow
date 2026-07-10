import { NextResponse } from 'next/server';
import { createProgramBrief, getLatestBrief } from '../../../../../lib/brief';
import { jsonError, serverError } from '../../../../../lib/api';
import { geminiConfigured } from '../../../../../lib/gemini';

// On-demand brief generation for one program (spec §2.12).
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const projectId = parseInt(id, 10);
    if (isNaN(projectId)) {
      return jsonError('Invalid project ID', 400);
    }
    if (!geminiConfigured) {
      return jsonError('Gemini is not configured (GEMINI_API_KEY missing)', 503);
    }

    const briefId = await createProgramBrief(projectId, 'manual');
    if (!briefId) {
      return jsonError('Project not found or brief generation failed', 404);
    }

    const brief = await getLatestBrief(projectId);
    return NextResponse.json({ brief }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/brief');
  }
}

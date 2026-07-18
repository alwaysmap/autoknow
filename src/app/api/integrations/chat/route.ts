import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/db';
import { jsonError, serverError } from '../../../../lib/api';
import { requireRouteAuth } from '../../../../lib/routeAuth';
import { ingestContent, hashContent } from '../../../../lib/ingest';

// Plain-webhook chat ingestion (see README / admin page): accepts pasted chat text,
// independent of the JWT-verified Chat app at /api/chat/events. Because the text is
// attacker-controllable prose that ends up in Gemini prompts and the UI, this route
// carries its own auth (session or admin token — never proxy-only), validates its
// body, and stores briefings through the real ingest pipeline (digest, embedding,
// revision history, sourceRef dedupe) instead of writing bare ContextUrl rows.

const GENERIC_STOP_WORDS = new Set([
  'integration', 'project', 'platform', 'testing', 'core', 'system',
  'bring-up', 'configuration', 'bringup', 'power-on', 'poweron', 'compliance'
]);

const zBody = z.object({
  message: z.string().trim().min(1).max(20_000),
  sender: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    if (!(await requireRouteAuth(request))) {
      return jsonError('Unauthorized', 401);
    }

    const parsed = zBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError('Invalid message', 400);
    }
    const { message, sender } = parsed.data;

    // 1. Detect if it is a Status Briefing/Update share command
    const isShareUpdate = /share\s+update|status\s+update/i.test(message);

    if (isShareUpdate) {
      // Extract briefing text
      let briefingText = message
        .replace(/@autoknow/gi, '')
        .replace(/share\s+update:?/gi, '')
        .replace(/status\s+update\s+for\s+["']?[^"']+\n?["']?:?/gi, '')
        .trim();

      // Clean leading colons or hyphens if any
      briefingText = briefingText.replace(/^[:-\s]+/, '');

      // Fetch all projects to match via classification agent confidence
      const projects = await prisma.project.findMany({
        include: { partner: true }
      });

      const messageLower = message.toLowerCase();
      const scoredProjects = projects.map(proj => {
        // Build stable keywords from project and partner names
        const cleanProjectName = proj.name.replace(/[^\w\s]/g, '').toLowerCase();
        const cleanPartnerName = proj.partner.name.replace(/[^\w\s]/g, '').toLowerCase();

        const projectKeywords = cleanProjectName.split(/\s+/).filter(w => w.length > 2);
        const partnerKeywords = cleanPartnerName.split(/\s+/).filter(w => w.length > 2);

        // Unique set of keywords
        const rawKeywords = Array.from(new Set([...projectKeywords, ...partnerKeywords]));

        // Filter out generic domain stop words
        const keywords = rawKeywords.filter(kw => !GENERIC_STOP_WORDS.has(kw));

        // Count how many unique project keywords appear in the inbound message
        let matchCount = 0;
        for (const kw of keywords) {
          if (messageLower.includes(kw)) {
            matchCount++;
          }
        }

        return {
          project: proj,
          score: matchCount
        };
      });

      // Filter projects that have at least 1 match
      const matchingProjects = scoredProjects.filter(p => p.score > 0);

      // Sort by score descending
      matchingProjects.sort((a, b) => b.score - a.score);

      // Rule: Must match exactly one project with high confidence.
      const hasMatch = matchingProjects.length > 0;
      const isAmbiguous = matchingProjects.length > 1 && matchingProjects[0].score === matchingProjects[1].score;

      if (!hasMatch || isAmbiguous) {
        return NextResponse.json({
          ingested: false,
          error: "I don't have a project matching this message or comment. Create one first or provide more context."
        });
      }

      // High-confidence matching project
      const matchedProject = matchingProjects[0].project;

      // Store through the real pipeline: digest + embedding + initial revision +
      // sourceRef dedupe (a re-posted briefing points at the existing row instead
      // of accumulating invisible-to-search duplicates).
      const briefingHash = hashContent(`${sender ?? ''}:${briefingText}`).slice(0, 16);
      const result = await ingestContent({
        url: `google-chat://status-update/${briefingHash}`,
        title: `Chat status update by ${sender ?? '@user'}`,
        text: briefingText,
        source: { kind: 'chat', mode: 'snapshot', sourceRef: `chat:status-update:${briefingHash}` },
        mode: 'snapshot',
        modeSource: 'inferred',
        anchor: { projectId: matchedProject.id },
        addedBy: sender ?? null,
      });

      if (!result.ok) {
        return jsonError(result.error ?? 'Ingest failed', 422);
      }

      return NextResponse.json({
        ingested: true,
        projectName: matchedProject.name,
        duplicate: !!result.duplicateOf,
      });
    }

    // 2. Fallback to extracting individual action items if mentioned
    const isMentioned = message.includes('@autoknow');

    // Look for assignees like @jdoe or @dylan
    const assigneeMatch = message.match(/@(\w+)\b/g);
    const assignedTo = assigneeMatch
      ? assigneeMatch.find(name => name !== '@autoknow') || null
      : null;

    const actionKeywords = ['need', 'needs', 'should', 'must', 'block', 'action'];
    const hasActionKeyword = actionKeywords.some(keyword => message.toLowerCase().includes(keyword));

    if (isMentioned && hasActionKeyword && assignedTo) {
      let description = message
        .replace(/@autoknow/g, '')
        .replace(new RegExp(assignedTo, 'g'), '')
        .trim();

      description = description
        .replace(/^(need|needs|should|must)\s+to\b/i, '')
        .replace(/^(need|needs|should|must)\b/i, '')
        .replace(/\bby\s+\w+$/i, '')
        .trim();

      return NextResponse.json({
        actionItem: {
          description: description,
          assignedTo: assignedTo,
          status: 'Pending'
        }
      });
    }

    // No actionable items detected
    return NextResponse.json({
      actionItem: null
    });
  } catch (error) {
    return serverError(error, 'POST /api/integrations/chat');
  }
}

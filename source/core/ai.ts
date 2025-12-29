import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {GoogleGenerativeAI} from '@google/generative-ai';
import {z} from 'zod';
import {ProjectMeta, RiskAssessment} from './types.js';

const ResponseSchema = z.object({
	className: z.enum(['Critical', 'Active', 'Burner']),
	score: z.number().min(0).max(10),
	reasons: z.array(z.string()).optional(),
});

const extractJson = (raw: string) => {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	return raw.slice(start, end + 1);
};

export const hashFile = async (filePath: string) => {
	const data = await fs.readFile(filePath);
	return crypto.createHash('sha256').update(data).digest('hex');
};

export type GeminiOptions = {
	apiKey: string;
	model?: string;
};

export const classifyWithGemini = async (
	project: ProjectMeta,
	packageJsonHash: string,
	options: GeminiOptions,
): Promise<RiskAssessment | null> => {
	const client = new GoogleGenerativeAI(options.apiKey);
	const modelName = options.model ?? 'gemini-2.5-flash-lite';
	const model = client.getGenerativeModel({model: modelName});

	const prompt = `You are a risk classifier for developer projects.\n\nClassify the project into one of: Critical (8-10), Active (5-7), Burner (0-4).\nReturn strict JSON with keys: className, score, reasons.\n\nProject summary:\n- name: ${project.name}\n- path: ${project.path}\n- dependencyCount: ${project.dependencyCount}\n- hasGit: ${project.hasGit}\n- hasEnvFile: ${project.hasEnvFile}\n- hasStartupKeyword: ${project.hasStartupKeyword}\n- lastModifiedDays: ${project.lastModifiedDays}\n- packageJsonHash: ${packageJsonHash}\n`;

	try {
		const result = await model.generateContent(prompt);
		const text = result.response.text();
		const jsonText = extractJson(text);
		if (!jsonText) return null;
		const parsed = ResponseSchema.safeParse(JSON.parse(jsonText));
		if (!parsed.success) return null;
		return {
			className: parsed.data.className,
			score: parsed.data.score,
			reasons: parsed.data.reasons ?? [],
			source: 'ai',
		};
	} catch {
		return null;
	}
};

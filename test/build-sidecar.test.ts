import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dir, "..");
const distDir = join(root, "dist");
const bundlePath = join(distDir, "index.js");
const sidecarPath = join(distDir, "index.js.omp-imports.json");
const hostToolAbortPath = join(
	root,
	"node_modules",
	"@oh-my-pi",
	"pi-coding-agent",
	"src",
	"tools",
	"tool-errors.ts",
);

type SidecarImport = {
	kind: string;
	specifier: string;
	start: number;
	end: number;
};

type Sidecar = {
	version: number;
	sha256: string;
	imports: SidecarImport[];
};

type RuntimeProbeResult = {
	tools: string[];
	handlers: string[];
	toolAbortIdentity: boolean;
};

async function runBuild(): Promise<void> {
	const proc = Bun.spawn(["bun", "scripts/build.ts"], {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`build failed with exit code ${code}`);
}

function readSidecar(): Sidecar {
	return JSON.parse(readFileSync(sidecarPath, "utf8")) as Sidecar;
}

function expectedRanges(source: string, scanned: Array<{ kind: string; path: string }>): SidecarImport[] {
	let cursor = 0;
	const imports: SidecarImport[] = [];
	for (const entry of scanned) {
		const token = JSON.stringify(entry.path);
		const markers =
			entry.kind === "dynamic-import"
				? [`import(${token})`]
				: [`from ${token}`, `import ${token}`];
		let best: { offset: number; marker: string } | undefined;
		for (const marker of markers) {
			const offset = source.indexOf(marker, cursor);
			if (offset === -1) continue;
			if (!best || offset < best.offset) best = { offset, marker };
		}
		if (!best) throw new Error(`missing marker for ${entry.kind} ${token}`);
		const start = best.offset + best.marker.indexOf(token);
		const end = start + token.length;
		imports.push({ kind: entry.kind, specifier: entry.path, start, end });
		cursor = end;
	}
	return imports;
}

async function runRuntimeProbe(): Promise<RuntimeProbeResult> {
	const probeDir = mkdtempSync(join(tmpdir(), "morph-build-sidecar-probe-"));
	const sampleDir = mkdtempSync(join(tmpdir(), "morph-build-sidecar-sample-"));
	const probePath = join(probeDir, "probe.mjs");
	writeFileSync(join(sampleDir, "sample.ts"), "export const x = 1;\n");

	const bundleUrl = pathToFileURL(bundlePath).href;
	const toolAbortUrl = pathToFileURL(hostToolAbortPath).href;
	const sampleDirJson = JSON.stringify(sampleDir);

	writeFileSync(
		probePath,
		[
			`import morphPlugin from ${JSON.stringify(bundleUrl)};`,
			`import { ToolAbortError } from ${JSON.stringify(toolAbortUrl)};`,
			`import * as zod from "zod/v4";`,
			``,
			`const tools = [];`,
			`const handlers = {};`,
			`const pi = {`,
			`  zod,`,
			`  logger: { debug() {}, info() {}, warn() {}, error() {} },`,
			`  registerTool(tool) { tools.push(tool); },`,
			`  on(event, handler) { (handlers[event] ??= []).push(handler); },`,
			`  registerCommand() {},`,
			`};`,
			``,
			`await morphPlugin(pi);`,
			``,
			`const tool = tools.find((entry) => entry.name === "fast_edit");`,
			`if (!tool) throw new Error("fast_edit not registered");`,
			``,
			`const controller = new AbortController();`,
			`controller.abort();`,
			`let toolAbortIdentity = false;`,
			`try {`,
			`  await tool.execute(`,
			`    "call-id",`,
			`    {`,
			`      target_filepath: "sample.ts",`,
			`      instructions: "bump",`,
			`      code_edit: "// ... existing code ...\\nexport const x = 2;\\n// ... existing code ...",`,
			`    },`,
			`    controller.signal,`,
			`    undefined,`,
			`    { cwd: ${sampleDirJson} },`,
			`  );`,
			`  throw new Error("expected fast_edit to reject on abort");`,
			`} catch (error) {`,
			`  toolAbortIdentity = error instanceof ToolAbortError;`,
			`}`,
			``,
			`process.stdout.write(JSON.stringify({`,
			`  tools: tools.map((entry) => entry.name).sort(),`,
			`  handlers: Object.keys(handlers).sort(),`,
			`  toolAbortIdentity,`,
			`}));`,
			``,
		].join("\n"),
	);

	try {
		const proc = Bun.spawn(["bun", probePath], {
			cwd: root,
			env: {
				...process.env,
				MORPH_API_KEY: process.env.MORPH_API_KEY ?? "sk-test-build-sidecar",
				MORPH_WARPGREP: "true",
				MORPH_WARPGREP_GITHUB: "true",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		if (code !== 0) {
			throw new Error(`runtime probe failed with exit code ${code}\n${stderr || stdout}`);
		}
		return JSON.parse(stdout) as RuntimeProbeResult;
	} finally {
		rmSync(probeDir, { recursive: true, force: true });
		rmSync(sampleDir, { recursive: true, force: true });
	}
}

describe("build sidecar artifacts", () => {
	beforeAll(async () => {
		process.env.MORPH_API_KEY ??= "sk-test-build-sidecar";
		process.env.MORPH_WARPGREP = "true";
		process.env.MORPH_WARPGREP_GITHUB = "true";
		await runBuild();
	});

	test("emits exactly the bundled entry and hash-bound sidecar", () => {
		expect(existsSync(bundlePath)).toBe(true);
		expect(existsSync(sidecarPath)).toBe(true);
		expect(readdirSync(distDir).sort()).toEqual(["index.js", "index.js.omp-imports.json"]);
	});

	test("sidecar version, sha binding, scan order, and token ranges are correct", () => {
		const source = readFileSync(bundlePath, "utf8");
		const sidecar = readSidecar();
		const scanned = new Bun.Transpiler({ loader: "js" }).scanImports(source);
		const expectedSha = new Bun.CryptoHasher("sha256").update(source).digest("hex");
		const expected = expectedRanges(source, scanned);

		expect(sidecar.version).toBe(1);
		expect(sidecar.sha256).toBe(expectedSha);
		expect(sidecar.imports.map((entry) => ({ kind: entry.kind, specifier: entry.specifier }))).toEqual(
			scanned.map((entry) => ({ kind: entry.kind, specifier: entry.path })),
		);
		expect(sidecar.imports).toEqual(expected);

		for (const entry of sidecar.imports) {
			expect(source.slice(entry.start, entry.end)).toBe(JSON.stringify(entry.specifier));
		}
		for (let i = 1; i < sidecar.imports.length; i++) {
			expect(sidecar.imports[i]!.start).toBeGreaterThanOrEqual(sidecar.imports[i - 1]!.end);
		}
	});

	test("static imports are host packages or builtins; dynamic imports are builtins", () => {
		const sidecar = readSidecar();
		for (const entry of sidecar.imports) {
			if (entry.kind === "import-statement") {
				expect(
					entry.specifier.startsWith("@oh-my-pi/") || module.isBuiltin(entry.specifier),
				).toBe(true);
			} else if (entry.kind === "dynamic-import") {
				expect(module.isBuiltin(entry.specifier)).toBe(true);
			} else {
				throw new Error(`unexpected sidecar import kind: ${entry.kind}`);
			}
		}
	});

	test("built default export registers Morph tools and hooks", async () => {
		const probe = await runRuntimeProbe();
		expect(probe.tools).toEqual([
			"codebase_warpsearch",
			"fast_edit",
			"fastcompact",
			"github_warpsearch",
		]);
		expect(probe.handlers).toEqual(["before_agent_start", "session_before_compact"]);
	});

	test("built bundle preserves ToolAbortError identity with the host package", async () => {
		const probe = await runRuntimeProbe();
		expect(probe.toolAbortIdentity).toBe(true);
	});

	test("two consecutive builds produce the same SHA-256", async () => {
		const first = readSidecar().sha256;
		await runBuild();
		const second = readSidecar().sha256;
		expect(second).toBe(first);
		expect(second).toMatch(/^[a-f0-9]{64}$/);
	});
});

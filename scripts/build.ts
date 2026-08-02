#!/usr/bin/env bun

import { mkdir, rm } from "node:fs/promises";
import module from "node:module";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist");
const entryOut = join(outDir, "index.js");
const sidecarOut = join(outDir, "index.js.omp-imports.json");

type ScannedImport = {
	kind: string;
	path: string;
};

type SidecarImport = {
	kind: string;
	specifier: string;
	start: number;
	end: number;
};

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function locateSpecifierRange(
	source: string,
	kind: string,
	specifier: string,
	cursor: number,
): { start: number; end: number; nextCursor: number } {
	const token = JSON.stringify(specifier);
	const markers =
		kind === "dynamic-import"
			? [`import(${token})`]
			: [`from ${token}`, `import ${token}`];

	let best: { offset: number; marker: string } | undefined;
	for (const marker of markers) {
		const offset = source.indexOf(marker, cursor);
		if (offset === -1) continue;
		if (!best || offset < best.offset) best = { offset, marker };
	}
	if (!best) {
		fail(
			`Failed to locate ${kind} specifier ${token} in bundled output after offset ${cursor}`,
		);
	}

	const tokenIndex = best.marker.indexOf(token);
	if (tokenIndex < 0) {
		fail(`Marker ${JSON.stringify(best.marker)} does not contain ${token}`);
	}
	const start = best.offset + tokenIndex;
	const end = start + token.length;
	return { start, end, nextCursor: end };
}

function buildSidecarImports(source: string, scanned: ScannedImport[]): SidecarImport[] {
	let cursor = 0;
	const imports: SidecarImport[] = [];

	for (const entry of scanned) {
		if (entry.kind === "import-statement") {
			// accepted
		} else if (entry.kind === "dynamic-import") {
			if (!module.isBuiltin(entry.path)) {
				fail(
					`Rejected dynamic import of non-builtin ${JSON.stringify(entry.path)}; only node builtins are allowed`,
				);
			}
		} else {
			fail(
				`Rejected scanned import kind ${JSON.stringify(entry.kind)} for ${JSON.stringify(entry.path)}; only import-statement and builtin dynamic-import are allowed`,
			);
		}

		const range = locateSpecifierRange(source, entry.kind, entry.path, cursor);
		if (imports.length > 0 && range.start < imports[imports.length - 1]!.end) {
			fail(
				`Import ranges must be ascending and non-overlapping; ${JSON.stringify(entry.path)} starts at ${range.start} before previous end ${imports[imports.length - 1]!.end}`,
			);
		}

		imports.push({
			kind: entry.kind,
			specifier: entry.path,
			start: range.start,
			end: range.end,
		});
		cursor = range.nextCursor;
	}

	return imports;
}

async function main(): Promise<void> {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const result = await Bun.build({
		entrypoints: [join(root, "src", "index.ts")],
		outdir: outDir,
		target: "bun",
		format: "esm",
		naming: "index.js",
		external: ["@oh-my-pi/*"],
		splitting: false,
	});

	if (!result.success) {
		const details = result.logs
			.map((log) => (typeof log === "object" && log && "message" in log ? String(log.message) : String(log)))
			.join("\n");
		fail(`Bun.build failed:\n${details || "(no build logs)"}`);
	}

	const source = await Bun.file(entryOut).text();
	const scanned = new Bun.Transpiler({ loader: "js" }).scanImports(source) as ScannedImport[];
	const imports = buildSidecarImports(source, scanned);
	const sha256 = new Bun.CryptoHasher("sha256").update(source).digest("hex");

	const sidecar = {
		version: 1 as const,
		sha256,
		imports,
	};

	await Bun.write(sidecarOut, `${JSON.stringify(sidecar, null, 2)}\n`);
	console.log(`Built ${entryOut}`);
	console.log(`Wrote ${sidecarOut} (${imports.length} imports, sha256=${sha256})`);
}

await main();

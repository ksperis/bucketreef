import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const docsRoot = path.join(repoRoot, "doc", "docs");
const screenshotsDir = path.join(docsRoot, "assets", "screenshots", "user");
const readmePath = path.join(repoRoot, "README.md");
const guideRoots = ["admin/en", "developer/en", "manager/en", "portal/en", "portal/fr", "browser/en"];
const ALLOWED_EXTRA_SCREENSHOTS = new Set();

const walkMarkdownFiles = async (rootDir) => {
  const files = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
};

const markdownFiles = (await Promise.all(
  guideRoots.map((guideRoot) => walkMarkdownFiles(path.join(docsRoot, guideRoot))),
)).flat().sort();

const errors = [];
const referencedScreenshots = new Set();
const referencedVideos = new Set();
let themedBlockCount = 0;

const stripFencedCodeBlocks = (content) => content.replace(/^```[\s\S]*?^```$/gm, "");
const expectedScreenshotRef = (imageName) => `/assets/screenshots/user/${imageName}`;

const extractThemedScreenshotReferences = (content) => {
  const blockMatches = [...content.matchAll(/<div[^>]+data-docs-themed-shot[^>]*>([\s\S]*?)<\/div>/g)];
  return blockMatches.map((match) => {
    const variants = {};
    for (const tagMatch of match[1].matchAll(/<img\b[^>]*>/g)) {
      const tag = tagMatch[0];
      const variant = tag.match(/data-docs-shot-variant=["'](light|dark)["']/)?.[1];
      const ref = tag.match(/src=["']([^"']+\.png)["']/)?.[1];
      if (variant && ref) {
        variants[variant] = { ref, fileName: path.basename(ref) };
      }
    }
    return {
      light: variants.light ?? null,
      dark: variants.dark ?? null,
    };
  });
};

const extractLegacyScreenshotReferences = (content) => (
  [...content.matchAll(/(?:\.\.\/)+assets\/screenshots\/user\/([^"')\s]+\.png)/g)]
    .map((match) => match[0])
);

const extractReadmeScreenshotReferences = (content) => (
  [...content.matchAll(/<img[^>]+src=["'](doc\/docs\/assets\/screenshots\/user\/[^"']+\.png)["'][^>]*>/g)]
    .map((match) => match[1])
);

const extractWorkflowVideoReferences = (content) => (
  [...content.matchAll(/src=["']\/assets\/screenshots\/user\/([^"']+\.webm)["']/g)]
    .map((match) => match[1])
);

const pngSize = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(pngSignature)) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

for (const filePath of markdownFiles) {
  const pageName = path.relative(docsRoot, filePath);
  const content = stripFencedCodeBlocks(await fs.readFile(filePath, "utf8"));
  const matches = extractThemedScreenshotReferences(content);
  const legacyMatches = extractLegacyScreenshotReferences(content);
  const videoMatches = extractWorkflowVideoReferences(content);

  if (legacyMatches.length > 0) {
    errors.push(`${pageName}: found legacy screenshot reference(s): ${legacyMatches.join(", ")}`);
  }

  themedBlockCount += matches.length;
  for (const fileName of videoMatches) {
    referencedVideos.add(fileName);
    try {
      await fs.access(path.join(screenshotsDir, fileName));
    } catch {
      errors.push(`${pageName}: missing workflow video file ${fileName}`);
    }
  }
  for (const [index, reference] of matches.entries()) {
    if (!reference.light || !reference.dark) {
      errors.push(`${pageName}: themed screenshot block ${index + 1} must include both light and dark variants`);
      continue;
    }

    const variants = [reference.light, reference.dark];
    const normalizedNames = variants.map((variant) => variant.fileName.replace(/\.(light|dark)\.png$/, ""));
    if (normalizedNames[0] !== normalizedNames[1]) {
      errors.push(`${pageName}: themed screenshot block ${index + 1} must use matching light/dark basenames`);
    }

    const dimensions = [];
    for (const variant of variants) {
      const imageName = variant.fileName;
      referencedScreenshots.add(imageName);

      if (variant.ref !== expectedScreenshotRef(imageName)) {
        errors.push(`${pageName}: screenshot block ${index + 1} uses an invalid path for ${imageName}: ${variant.ref}`);
        continue;
      }

      const resolvedPath = path.join(screenshotsDir, imageName);
      try {
        await fs.access(resolvedPath);
      } catch {
        errors.push(`${pageName}: missing screenshot file ${imageName}`);
        continue;
      }

      try {
        const { width, height } = await pngSize(resolvedPath);
        dimensions.push({ imageName, width, height });
        if (width <= 0 || height <= 0 || width > 1728 || height > 972) {
          errors.push(
            `${pageName}: screenshot ${imageName} has invalid bounds ${width}x${height} (maximum 1728x972)`
          );
        }
      } catch (error) {
        errors.push(`${pageName}: unable to validate ${imageName} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (
      dimensions.length === 2
      && (dimensions[0].width !== dimensions[1].width || dimensions[0].height !== dimensions[1].height)
    ) {
      errors.push(
        `${pageName}: themed screenshot block ${index + 1} must use matching light/dark dimensions `
        + `(${dimensions[0].imageName} is ${dimensions[0].width}x${dimensions[0].height}; `
        + `${dimensions[1].imageName} is ${dimensions[1].width}x${dimensions[1].height})`
      );
    }
  }
}

const readmeContent = await fs.readFile(readmePath, "utf8");
for (const ref of extractReadmeScreenshotReferences(readmeContent)) {
  const fileName = path.basename(ref);
  referencedScreenshots.add(fileName);
  try {
    await fs.access(path.resolve(repoRoot, ref));
  } catch {
    errors.push(`README.md: missing screenshot file ${ref}`);
  }
}

const screenshotFiles = new Set((await fs.readdir(screenshotsDir)).filter((name) => name.endsWith(".png")));
const unexpectedScreenshots = [...screenshotFiles]
  .filter((name) => !referencedScreenshots.has(name) && !ALLOWED_EXTRA_SCREENSHOTS.has(name))
  .sort();
if (unexpectedScreenshots.length > 0) {
  errors.push(`unexpected screenshot file(s): ${unexpectedScreenshots.join(", ")}`);
}
const videoFiles = new Set((await fs.readdir(screenshotsDir)).filter((name) => name.endsWith(".webm")));
const unexpectedVideos = [...videoFiles]
  .filter((name) => !referencedVideos.has(name))
  .sort();
if (unexpectedVideos.length > 0) {
  errors.push(`unexpected workflow video file(s): ${unexpectedVideos.join(", ")}`);
}

if (errors.length > 0) {
  console.error("Documentation screenshot check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Screenshot check passed for ${markdownFiles.length} guide page(s) and ${themedBlockCount} themed block(s).`);

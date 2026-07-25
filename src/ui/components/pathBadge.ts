import type { PathReferenceSummary } from "../../shared/contracts.js";

export type PathIcon = "file" | "document" | "sheet" | "presentation" | "code" | "image" | "video" | "audio" | "archive" | "folder";
export interface PathBadge { label: string; tone: string; icon: PathIcon }

const badges: Record<string, Omit<PathBadge, "icon">> = Object.fromEntries([
  ["pdf", "PDF", "pdf"], ["doc docx pages odt", "DOC", "word"], ["rtf", "RTF", "word"],
  ["ppt pptx odp", "PPT", "presentation"], ["key", "KEY", "presentation"],
  ["xls xlsx numbers ods", "XLS", "sheet"], ["csv", "CSV", "sheet"], ["tsv", "TSV", "sheet"],
  ["txt", "TXT", "text"], ["md", "MD", "text"], ["epub", "EPUB", "text"],
  ["js", "JS", "javascript"], ["jsx", "JSX", "javascript"], ["ts", "TS", "typescript"], ["tsx", "TSX", "typescript"], ["py", "PY", "python"],
  ["html htm", "HTML", "web"], ["svelte", "SV", "web"], ["css", "CSS", "css"], ["scss", "SCSS", "css"], ["less", "LESS", "css"], ["vue", "VUE", "vue"],
  ["json", "JSON", "data"], ["yaml yml", "YML", "data"], ["toml", "TOML", "data"], ["xml", "XML", "data"], ["sql", "SQL", "data"],
  ["sh bash", "SH", "shell"], ["zsh", "ZSH", "shell"], ["c", "C", "native"], ["h", "H", "native"], ["cc cpp", "C++", "native"],
  ["cs", "C#", "dotnet"], ["java", "JAVA", "java"], ["kt kts", "KT", "java"], ["swift", "SW", "swift"], ["go", "GO", "go"], ["rs", "RS", "rust"], ["rb", "RB", "ruby"], ["php", "PHP", "php"],
  ["png jpg jpeg webp avif heic", "IMG", "image"], ["gif", "GIF", "image"], ["svg", "SVG", "image"],
  ["mp4 mov webm mkv avi m4v", "▶", "video"], ["mp3 wav m4a aac flac ogg opus", "♪", "audio"],
  ["zip", "ZIP", "archive"], ["rar", "RAR", "archive"], ["7z", "7Z", "archive"], ["tar", "TAR", "archive"], ["gz", "GZ", "archive"], ["tgz", "TGZ", "archive"], ["dmg", "DMG", "archive"],
].flatMap(([extensions, label, tone]) => String(extensions).split(" ").map((extension) => [extension, { label, tone }])));

const fallback: Record<PathReferenceSummary["kind"], Omit<PathBadge, "icon">> = {
  code: { label: "CODE", tone: "code" }, image: { label: "IMG", tone: "image" }, document: { label: "DOC", tone: "word" },
  sheet: { label: "XLS", tone: "sheet" }, archive: { label: "ZIP", tone: "archive" }, media: { label: "AV", tone: "video" },
  generic: { label: "FILE", tone: "generic" }, folder: { label: "DIR", tone: "folder" },
};

export function pathBadge(path: PathReferenceSummary): PathBadge {
  if (path.isDirectory || path.kind === "folder") return withIcon(fallback.folder);
  const lower = path.name.toLowerCase();
  if (lower === "dockerfile") return withIcon({ label: "DOCK", tone: "docker" });
  if (lower === "makefile") return withIcon({ label: "MAKE", tone: "shell" });
  return withIcon(badges[lower.split(".").at(-1) || ""] || fallback[path.kind]);
}

function withIcon(badge: Omit<PathBadge, "icon">): PathBadge {
  const icon: PathIcon = badge.tone === "folder" ? "folder"
    : badge.tone === "sheet" ? "sheet"
      : badge.tone === "presentation" ? "presentation"
        : badge.tone === "image" ? "image"
          : badge.tone === "video" ? "video"
            : badge.tone === "audio" ? "audio"
              : badge.tone === "archive" ? "archive"
                : ["word", "text", "pdf"].includes(badge.tone) ? "document"
                  : ["javascript", "typescript", "python", "web", "css", "vue", "dotnet", "php", "shell", "docker", "native", "rust", "java", "swift", "ruby", "go", "code"].includes(badge.tone) ? "code"
                    : "file";
  return { ...badge, icon };
}

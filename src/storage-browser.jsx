import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  Folder, File, FileText, FileSpreadsheet, FileArchive, FileCode, Image, Music,
  Video, Upload, Search, LayoutGrid, List as ListIcon, Trash2, Download,
  ChevronRight, HardDrive, FolderPlus, X, ArrowUp, ArrowDown, Database, Pencil,
  Plus, Eye, Share2, Settings as SettingsIcon, Users, Clock, RotateCcw, Link2,
  ShieldAlert, Boxes,
} from "lucide-react";

// ================= helpers =================

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now();

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const folder = (name, children, modified) => ({
  id: uid(), name, type: "folder", children, modified,
});

const seedFile = (name, size, modified) => ({
  id: uid(), name, type: "file", size, modified,
  versions: [], shared: false, sharedWith: [],
});

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(d, withTime) {
  if (!d) return "—";
  const opts = withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(d));
}

function getExt(name) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
const VIDEO_EXT = ["mp4", "mov", "avi", "mkv", "webm"];
const AUDIO_EXT = ["mp3", "wav", "flac", "m4a"];
const ARCHIVE_EXT = ["zip", "tar", "gz", "rar", "7z"];
const SHEET_EXT = ["csv", "xlsx", "xls"];
const CODE_EXT = ["js", "ts", "jsx", "tsx", "py", "rb", "go", "java", "c", "cpp", "json", "yml", "yaml", "html", "css", "sh"];
const DOC_EXT = ["pdf", "doc", "docx", "txt", "md"];
const TEXT_PREVIEW_EXT = Array.from(new Set([...CODE_EXT, "txt", "md", "csv"]));

function getFileIcon(name) {
  const ext = getExt(name);
  if (IMAGE_EXT.includes(ext)) return Image;
  if (VIDEO_EXT.includes(ext)) return Video;
  if (AUDIO_EXT.includes(ext)) return Music;
  if (ARCHIVE_EXT.includes(ext)) return FileArchive;
  if (SHEET_EXT.includes(ext)) return FileSpreadsheet;
  if (CODE_EXT.includes(ext)) return FileCode;
  if (DOC_EXT.includes(ext)) return FileText;
  return File;
}

function getKind(node) {
  if (node.type === "folder") return "Folder";
  const ext = getExt(node.name);
  return ext ? `${ext.toUpperCase()} file` : "File";
}

function getFolderAtPath(node, path) {
  if (path.length === 0) return node;
  const [head, ...rest] = path;
  const child = node.children.find((c) => c.id === head && c.type === "folder");
  return child ? getFolderAtPath(child, rest) : node;
}

function updateFolderChildren(node, path, updater) {
  if (path.length === 0) return { ...node, children: updater(node.children) };
  const [head, ...rest] = path;
  return {
    ...node,
    children: node.children.map((child) =>
      child.id === head ? updateFolderChildren(child, rest, updater) : child
    ),
  };
}

function findNodeById(node, id) {
  if (node.id === id) return node;
  if (node.children) {
    for (const c of node.children) {
      const r = findNodeById(c, id);
      if (r) return r;
    }
  }
  return null;
}

function findPathIds(node, targetId, acc = []) {
  if (node.children) {
    for (const c of node.children) {
      if (c.id === targetId) return [...acc, c.id];
      const res = findPathIds(c, targetId, [...acc, c.id]);
      if (res) return res;
    }
  }
  return null;
}

function resolveItemPath(root, id) {
  const chainIds = findPathIds(root, id);
  if (!chainIds) return null;
  let node = root;
  const names = [];
  for (const cid of chainIds) {
    node = node.children.find((c) => c.id === cid);
    if (!node) return null;
    names.push(node.name);
  }
  const name = names.pop();
  return { folderPath: names.join("/"), name, fullPath: [...names, name].join("/") };
}

function pathIdsToNames(root, pathIds) {
  let node = root;
  const names = [];
  for (const id of pathIds) {
    node = node.children.find((c) => c.id === id);
    if (!node) break;
    names.push(node.name);
  }
  return names;
}

function removeIds(node, idsSet) {
  return {
    ...node,
    children: node.children
      .filter((c) => !idsSet.has(c.id))
      .map((c) => (c.type === "folder" ? removeIds(c, idsSet) : c)),
  };
}

function calcSize(node) {
  if (node.type === "file") return node.size || 0;
  return (node.children || []).reduce((s, c) => s + calcSize(c), 0);
}

function calcFileCount(node) {
  if (node.type === "file") return 1;
  return (node.children || []).reduce((s, c) => s + calcFileCount(c), 0);
}

function compareItems(a, b, sortBy, sortDir) {
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
  let res = 0;
  if (sortBy === "name") res = a.name.localeCompare(b.name);
  else if (sortBy === "size") res = (a.size || 0) - (b.size || 0);
  else if (sortBy === "modified") res = new Date(a.modified) - new Date(b.modified);
  else if (sortBy === "type") res = getKind(a).localeCompare(getKind(b));
  return sortDir === "asc" ? res : -res;
}

// ---- serialization for persistence (Date -> ISO, drop binary File refs) ----

function serializeNode(node) {
  if (node.type === "folder") {
    return {
      id: node.id, name: node.name, type: "folder",
      modified: node.modified ? new Date(node.modified).toISOString() : null,
      children: node.children.map(serializeNode),
    };
  }
  return {
    id: node.id, name: node.name, type: "file",
    size: node.size, modified: new Date(node.modified).toISOString(),
    versions: (node.versions || []).map((v) => ({ id: v.id, size: v.size, modified: new Date(v.modified).toISOString() })),
    shared: !!node.shared,
    sharedWith: node.sharedWith || [],
  };
}
function deserializeNode(obj) {
  if (obj.type === "folder") {
    return {
      id: obj.id, name: obj.name, type: "folder",
      modified: obj.modified ? new Date(obj.modified) : new Date(),
      children: (obj.children || []).map(deserializeNode),
    };
  }
  return {
    id: obj.id, name: obj.name, type: "file",
    size: obj.size, modified: new Date(obj.modified),
    versions: (obj.versions || []).map((v) => ({ id: v.id, size: v.size, modified: new Date(v.modified) })),
    shared: !!obj.shared,
    sharedWith: obj.sharedWith || [],
  };
}
const serializeBucket = (b) => ({ id: b.id, name: b.name, root: serializeNode(b.root) });
const deserializeBucket = (o) => ({ id: o.id, name: o.name, root: deserializeNode(o.root) });

// ---- seed data ----

function makeSeed() {
  return [
    {
      id: uid(),
      name: "production-assets",
      root: {
        id: "root", name: "", type: "folder",
        children: [
          folder("images", [
            seedFile("hero-banner.png", 2450000, daysAgo(2)),
            seedFile("logo-dark.svg", 18400, daysAgo(40)),
            seedFile("logo-light.svg", 17900, daysAgo(40)),
            folder("thumbnails", [
              seedFile("product-1-thumb.jpg", 340000, daysAgo(10)),
              seedFile("product-2-thumb.jpg", 355000, daysAgo(10)),
            ], daysAgo(10)),
          ], daysAgo(40)),
          folder("videos", [
            seedFile("onboarding-walkthrough.mp4", 84500000, daysAgo(5)),
            seedFile("feature-demo-q3.mov", 210300000, daysAgo(1)),
          ], daysAgo(5)),
          folder("documents", [
            seedFile("brand-guidelines.pdf", 4200000, daysAgo(90)),
            seedFile("press-kit.zip", 18900000, daysAgo(120)),
          ], daysAgo(90)),
          seedFile("README.md", 1240, daysAgo(200)),
        ],
      },
    },
    {
      id: uid(),
      name: "analytics-exports",
      root: {
        id: "root", name: "", type: "folder",
        children: [
          folder("2026", [
            folder("q1", [
              seedFile("user-events-jan.csv", 12400000, daysAgo(240)),
              seedFile("user-events-feb.csv", 13100000, daysAgo(210)),
              seedFile("user-events-mar.csv", 11950000, daysAgo(180)),
            ], daysAgo(180)),
            folder("q2", [
              seedFile("user-events-apr.csv", 14020000, daysAgo(150)),
              seedFile("user-events-may.csv", 13760000, daysAgo(120)),
              seedFile("revenue-summary.xlsx", 890000, daysAgo(95)),
            ], daysAgo(95)),
          ], daysAgo(95)),
          folder("scripts", [
            seedFile("etl_pipeline.py", 8400, daysAgo(30)),
            seedFile("schema.json", 2100, daysAgo(30)),
          ], daysAgo(30)),
          seedFile("churn-model-notes.txt", 3400, daysAgo(15)),
        ],
      },
    },
  ];
}

function defaultMembers(buckets) {
  const map = {};
  for (const b of buckets) {
    map[b.id] = [
      { id: uid(), name: "You", email: "you@company.com", role: "owner" },
      { id: uid(), name: "Priya Nair", email: "priya@company.com", role: "editor" },
      { id: uid(), name: "Sam Osei", email: "sam@company.com", role: "viewer" },
    ];
  }
  return map;
}

const QUOTA_BYTES = 500 * 1024 ** 3;
const STORAGE_KEY = "storage-app:v1";

// ---- REST adapter (real fetch calls, used only when Settings -> REST API is connected) ----

async function restTestConnection(baseUrl, apiKey) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const res = await fetch(`${base}/health`, { headers });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return true;
}

async function restUpload(config, bucketName, folderPath, fileObj) {
  const base = config.baseUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
  const initRes = await fetch(`${base}/uploads/init`, {
    method: "POST", headers,
    body: JSON.stringify({ bucket: bucketName, path: folderPath, filename: fileObj.name, size: fileObj.size, contentType: fileObj.type || "application/octet-stream" }),
  });
  if (!initRes.ok) throw new Error(`init failed (${initRes.status})`);
  const { uploadUrl, objectId } = await initRes.json();
  const putRes = await fetch(uploadUrl, { method: "PUT", body: fileObj });
  if (!putRes.ok) throw new Error(`upload failed (${putRes.status})`);
  await fetch(`${base}/uploads/complete`, { method: "POST", headers, body: JSON.stringify({ objectId }) });
  return objectId;
}

async function restDeleteMany(config, bucketName, items) {
  const base = config.baseUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
  const results = await Promise.allSettled(
    items.map((it) =>
      fetch(`${base}/objects`, { method: "DELETE", headers, body: JSON.stringify({ bucket: bucketName, path: it.fullPath }) }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
    )
  );
  return { ok: results.filter((r) => r.status === "fulfilled").length, total: items.length };
}

const API_CONTRACT = `GET  /health                     -> 200 OK
GET  /buckets                    -> [{ id, name }]
POST /uploads/init   { bucket, path, filename, size, contentType }
                                  -> { uploadUrl, objectId }
PUT  {uploadUrl}                 -> raw file bytes (e.g. S3 presigned URL)
POST /uploads/complete  { objectId }
DELETE /objects  { bucket, path }
Auth: Authorization: Bearer <apiKey>`;

// ================= component =================

export default function StorageBrowser() {
  const seedRef = useRef(null);
  if (seedRef.current === null) seedRef.current = makeSeed();

  const [isLoaded, setIsLoaded] = useState(false);
  const [buckets, setBuckets] = useState(() => seedRef.current);
  const [currentBucketId, setCurrentBucketId] = useState(() => seedRef.current[0]?.id ?? null);
  const [membersByBucket, setMembersByBucket] = useState(() => ({}));
  const [backendConfig, setBackendConfig] = useState({ mode: "rest", baseUrl: "https://storage-browser.onrender.com", apiKey: "", status: "idle", statusMessage: "" });

  const [currentPath, setCurrentPath] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [viewMode, setViewMode] = useState("list");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploadQueue, setUploadQueue] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null);
  const [toast, setToast] = useState(null);
  const [newBucketDraft, setNewBucketDraft] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [mainTab, setMainTab] = useState("files");
  const [currentUserRole, setCurrentUserRole] = useState("owner");
  const [previewNode, setPreviewNode] = useState(null);
  const [shareNode, setShareNode] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const canEdit = currentUserRole !== "viewer";
  const isOwner = currentUserRole === "owner";

  // ---------- hydrate from persistent storage ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          const loaded = (data.buckets || []).map(deserializeBucket);
          const finalBuckets = loaded.length ? loaded : seedRef.current;
          setBuckets(finalBuckets);
          setCurrentBucketId(data.currentBucketId && finalBuckets.some((b) => b.id === data.currentBucketId) ? data.currentBucketId : finalBuckets[0]?.id ?? null);
          setViewMode(data.viewMode === "grid" ? "grid" : "list");
          setMembersByBucket(data.membersByBucket && Object.keys(data.membersByBucket).length ? data.membersByBucket : defaultMembers(finalBuckets));
          if (data.backendConfig) {
            setBackendConfig((bc) => ({ ...bc, mode: data.backendConfig.mode || "demo", baseUrl: data.backendConfig.baseUrl || "", apiKey: data.backendConfig.apiKey || "" }));
          }
        } else {
          setMembersByBucket(defaultMembers(seedRef.current));
        }
      } catch (e) {
        setMembersByBucket((mb) => (Object.keys(mb).length ? mb : defaultMembers(seedRef.current)));
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // ---------- persist on change (debounced) ----------
  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = JSON.stringify({
          buckets: buckets.map(serializeBucket),
          currentBucketId,
          viewMode,
          membersByBucket,
          backendConfig: { mode: backendConfig.mode, baseUrl: backendConfig.baseUrl },
        });
        const res = await window.storage.set(STORAGE_KEY, payload, false);
        if (!res) showToast("Couldn't save — storage unavailable");
      } catch (e) {
        showToast("Couldn't save — storage error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [buckets, currentBucketId, viewMode, membersByBucket, backendConfig.mode, backendConfig.baseUrl, backendConfig.apiKey, isLoaded, showToast]);

  const resetDemoData = async () => {
    if (!isOwner) {
      showToast("Only an owner can reset data");
      return;
    }
    try {
      await window.storage.delete(STORAGE_KEY, false);
    } catch (e) {
      /* key may not exist yet — fine */
    }
    const fresh = makeSeed();
    seedRef.current = fresh;
    setBuckets(fresh);
    setCurrentBucketId(fresh[0]?.id ?? null);
    setCurrentPath([]);
    setSelectedIds(new Set());
    setMembersByBucket(defaultMembers(fresh));
    showToast("Reset to demo data");
  };

  const currentBucket = buckets.find((b) => b.id === currentBucketId) || null;
  const currentFolder = useMemo(
    () => (currentBucket ? getFolderAtPath(currentBucket.root, currentPath) : null),
    [currentBucket, currentPath]
  );
  const members = (currentBucket && membersByBucket[currentBucket.id]) || [];

  const breadcrumb = useMemo(() => {
    if (!currentBucket) return [];
    const crumbs = [{ id: "root", name: currentBucket.name }];
    let node = currentBucket.root;
    for (const id of currentPath) {
      node = node.children.find((c) => c.id === id);
      if (!node) break;
      crumbs.push({ id: node.id, name: node.name });
    }
    return crumbs;
  }, [currentBucket, currentPath]);

  const currentPathString = breadcrumb.slice(1).map((c) => c.name).join("/");

  const displayItems = useMemo(() => {
    if (!currentBucket) return [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const results = [];
      const walk = (node, pathNames) => {
        for (const child of node.children) {
          if (child.name.toLowerCase().includes(q)) results.push({ ...child, __pathNames: pathNames });
          if (child.type === "folder") walk(child, [...pathNames, child.name]);
        }
      };
      walk(currentBucket.root, []);
      return results.sort((a, b) => compareItems(a, b, sortBy, sortDir));
    }
    if (!currentFolder) return [];
    return [...currentFolder.children].sort((a, b) => compareItems(a, b, sortBy, sortDir));
  }, [currentBucket, currentFolder, searchQuery, sortBy, sortDir]);

  const selectedNode = selectedIds.size === 1 && currentBucket ? findNodeById(currentBucket.root, [...selectedIds][0]) : null;

  const totalUsed = useMemo(() => buckets.reduce((s, b) => s + calcSize(b.root), 0), [buckets]);
  const usedPct = Math.min(100, (totalUsed / QUOTA_BYTES) * 100);

  // ---------- actions ----------

  const resetTransientUI = () => {
    setNewFolderDraft(false);
    setNewFolderName("");
    setRenamingId(null);
  };

  const switchBucket = (id) => {
    setCurrentBucketId(id);
    setCurrentPath([]);
    setSelectedIds(new Set());
    setSearchQuery("");
    setMainTab("files");
    resetTransientUI();
  };

  const navigateTo = (folderId) => {
    if (!currentBucket) return;
    const path = findPathIds(currentBucket.root, folderId);
    setCurrentPath(path || currentPath);
    setSearchQuery("");
    setSelectedIds(new Set());
    resetTransientUI();
  };

  const navigateToCrumb = (index) => {
    setCurrentPath(currentPath.slice(0, index));
    setSelectedIds(new Set());
    setSearchQuery("");
    resetTransientUI();
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("asc"); }
  };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectOnly = (id) => setSelectedIds(new Set([id]));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = displayItems.length > 0 && displayItems.every((i) => prev.has(i.id));
      return allSelected ? new Set() : new Set(displayItems.map((i) => i.id));
    });
  };

  const mutateCurrentFolderChildren = (updater) => {
    if (!currentBucket) return;
    setBuckets((bs) => bs.map((b) => (b.id === currentBucketId ? { ...b, root: updateFolderChildren(b.root, currentPath, updater) } : b)));
  };

  const mutateNode = (id, updater) => {
    if (!currentBucket) return;
    const applyToTree = (node) => {
      if (node.id === id) return updater(node);
      if (node.children) return { ...node, children: node.children.map(applyToTree) };
      return node;
    };
    setBuckets((bs) => bs.map((b) => (b.id === currentBucketId ? { ...b, root: applyToTree(b.root) } : b)));
  };

  const commitNewFolder = () => {
    if (!canEdit) { setNewFolderDraft(false); return; }
    const name = newFolderName.trim();
    if (name) {
      mutateCurrentFolderChildren((children) => [...children, folder(name, [], new Date())]);
      showToast(`Created folder "${name}"`);
    }
    setNewFolderDraft(false);
    setNewFolderName("");
  };

  const startRename = (node, e) => {
    if (e) e.stopPropagation();
    if (!canEdit) return;
    setRenamingId(node.id);
    setRenameValue(node.name);
  };

  const commitRename = () => {
    const name = renameValue.trim();
    if (name && renamingId) {
      mutateCurrentFolderChildren((children) => children.map((c) => (c.id === renamingId ? { ...c, name } : c)));
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const attemptDownload = (node, e) => {
    if (e) e.stopPropagation();
    if (node.fileObj) {
      const url = URL.createObjectURL(node.fileObj);
      const a = document.createElement("a");
      a.href = url; a.download = node.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Downloading ${node.name}`);
    } else {
      showToast(`"${node.name}" is demo data — nothing to download`);
    }
  };

  const requestDeleteIds = (ids, label) => {
    if (!canEdit) return;
    setConfirmAction({
      message: `Delete ${label}? This can't be undone.`,
      onConfirm: async () => {
        const idsSet = new Set(ids);
        let apiNote = "";
        if (currentBucket && backendConfig.mode === "rest") {
          const items = ids.map((id) => resolveItemPath(currentBucket.root, id)).filter(Boolean);
          try {
            const { ok, total } = await restDeleteMany(backendConfig, currentBucket.name, items);
            apiNote = ` (API: ${ok}/${total} confirmed)`;
          } catch (e) {
            apiNote = ` (API delete failed: ${e.message})`;
          }
        }
        setBuckets((bs) => bs.map((b) => (b.id === currentBucketId ? { ...b, root: removeIds(b.root, idsSet) } : b)));
        setSelectedIds(new Set());
        setConfirmAction(null);
        showToast(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}${apiNote}`);
      },
    });
  };

  const requestDeleteBucket = (bucket, e) => {
    e.stopPropagation();
    if (!isOwner) { showToast("Only an owner can delete a bucket"); return; }
    setConfirmAction({
      message: `Delete bucket "${bucket.name}" and everything inside it?`,
      onConfirm: () => {
        const remaining = buckets.filter((b) => b.id !== bucket.id);
        setBuckets(remaining);
        if (currentBucketId === bucket.id) {
          setCurrentBucketId(remaining[0]?.id ?? null);
          setCurrentPath([]);
          setSelectedIds(new Set());
        }
        setConfirmAction(null);
        showToast(`Deleted bucket "${bucket.name}"`);
      },
    });
  };

  const commitNewBucket = () => {
    if (!isOwner) {
      setNewBucketDraft(false);
      setNewBucketName("");
      showToast("Only an owner can create a bucket");
      return;
    }
    const name = newBucketName.trim();
    if (name) {
      const b = { id: uid(), name, root: { id: "root", name: "", type: "folder", children: [] } };
      setBuckets((bs) => [...bs, b]);
      setMembersByBucket((mb) => ({ ...mb, ...defaultMembers([b]) }));
      switchBucket(b.id);
      showToast(`Created bucket "${name}"`);
    }
    setNewBucketDraft(false);
    setNewBucketName("");
  };

  const handleFiles = (fileList) => {
    if (!canEdit) { showToast("Viewers can't upload files"); return; }
    const files = Array.from(fileList || []);
    if (!files.length || !currentBucket) return;
    const targetBucketId = currentBucketId;
    const targetPath = currentPath;
    const targetPathString = pathIdsToNames(currentBucket.root, targetPath).join("/");
    const bucketName = currentBucket.name;
    const queued = files.map((f) => ({ id: uid(), name: f.name, size: f.size, fileObj: f, progress: 0 }));
    setUploadQueue((q) => [...q, ...queued]);
    queued.forEach((item) => {
      let p = 0;
      const interval = setInterval(() => {
        p += Math.random() * 30 + 20;
        if (p >= 100) {
          clearInterval(interval);
          setUploadQueue((q) => q.filter((u) => u.id !== item.id));
          setBuckets((bs) =>
            bs.map((b) => {
              if (b.id !== targetBucketId) return b;
              return {
                ...b,
                root: updateFolderChildren(b.root, targetPath, (children) => {
                  const existingIdx = children.findIndex((c) => c.type === "file" && c.name === item.name);
                  if (existingIdx >= 0) {
                    const existing = children[existingIdx];
                    const newVersions = [{ id: uid(), size: existing.size, modified: existing.modified }, ...(existing.versions || [])];
                    const updated = { ...existing, size: item.size, modified: new Date(), fileObj: item.fileObj, versions: newVersions };
                    const copy = [...children];
                    copy[existingIdx] = updated;
                    return copy;
                  }
                  return [...children, { id: item.id, name: item.name, type: "file", size: item.size, modified: new Date(), fileObj: item.fileObj, versions: [], shared: false, sharedWith: [] }];
                }),
              };
            })
          );
          showToast(`Uploaded ${item.name}`);
          if (backendConfig.mode === "rest") {
            restUpload(backendConfig, bucketName, targetPathString, item.fileObj)
              .then(() => showToast(`Synced ${item.name} to API`))
              .catch((e) => showToast(`API upload failed for ${item.name}: ${e.message}`));
          }
        } else {
          setUploadQueue((q) => q.map((u) => (u.id === item.id ? { ...u, progress: p } : u)));
        }
      }, 200);
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const restoreVersion = (node, version) => {
    if (!canEdit) return;
    mutateNode(node.id, (n) => {
      const newVersions = [{ id: uid(), size: n.size, modified: n.modified }, ...n.versions.filter((v) => v.id !== version.id)];
      return { ...n, size: version.size, modified: new Date(), versions: newVersions, fileObj: undefined };
    });
    showToast(`Restored an earlier version of "${node.name}"`);
  };

  const setMemberRole = (memberId, role) => {
    if (!isOwner || !currentBucket) return;
    setMembersByBucket((mb) => ({
      ...mb,
      [currentBucket.id]: (mb[currentBucket.id] || []).map((m) => (m.id === memberId ? { ...m, role } : m)),
    }));
  };
  const removeMember = (memberId) => {
    if (!isOwner || !currentBucket) return;
    setMembersByBucket((mb) => ({ ...mb, [currentBucket.id]: (mb[currentBucket.id] || []).filter((m) => m.id !== memberId) }));
  };
  const addMember = (name, email, role) => {
    if (!isOwner || !currentBucket || !email.trim()) return;
    setMembersByBucket((mb) => ({
      ...mb,
      [currentBucket.id]: [...(mb[currentBucket.id] || []), { id: uid(), name: name.trim() || email.trim(), email: email.trim(), role }],
    }));
  };

  // ---------- render ----------

  if (!isLoaded) {
    return (
      <StorageShell>
        <div className="loading-screen">
          <Boxes size={28} strokeWidth={1.4} />
          <span>Loading your storage…</span>
        </div>
      </StorageShell>
    );
  }

  if (!currentBucket) {
    return (
      <StorageShell>
        <div className="empty-state" style={{ margin: "auto" }}>
          <Database size={40} strokeWidth={1.4} />
          <p className="empty-title">No buckets yet</p>
          <p className="empty-sub">Create a bucket to start storing files.</p>
          {newBucketDraft ? (
            <div className="inline-create">
              <input autoFocus className="text-input" value={newBucketName} onChange={(e) => setNewBucketName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitNewBucket(); if (e.key === "Escape") { setNewBucketDraft(false); setNewBucketName(""); } }}
                onBlur={commitNewBucket} placeholder="Bucket name" />
            </div>
          ) : isOwner ? (
            <button className="btn btn-accent" onClick={() => setNewBucketDraft(true)}><Plus size={15} /> New bucket</button>
          ) : (
            <p className="empty-sub">Ask an owner to create a bucket.</p>
          )}
        </div>
      </StorageShell>
    );
  }

  const IconForSelected = selectedNode ? (selectedNode.type === "folder" ? Folder : getFileIcon(selectedNode.name)) : null;

  return (
    <StorageShell>
      <div className="top-strip">
        <div className="brand">
          <Boxes size={17} />
          <span>DataVault</span>
        </div>
        <div className="top-strip-right">
          {backendConfig.mode === "rest" && (
            <span className={"backend-pill backend-" + (backendConfig.status === "connected" ? "ok" : backendConfig.status === "error" ? "bad" : "idle")}>
              {backendConfig.status === "connected" ? "API connected" : backendConfig.status === "error" ? "API unreachable" : "REST API (untested)"}
            </span>
          )}
          <label className="role-switch">
            <span>Viewing as</span>
            <select value={currentUserRole} onChange={(e) => setCurrentUserRole(e.target.value)}>
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          {isOwner && <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <SettingsIcon size={16} />
          </button>}
        </div>
      </div>

      <div className="body-row">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="bucket-list">
            {buckets.map((b) => {
              const active = b.id === currentBucketId;
              const size = calcSize(b.root);
              const count = calcFileCount(b.root);
              return (
                <div key={b.id} className={"bucket-row" + (active ? " bucket-row-active" : "")} onClick={() => switchBucket(b.id)}>
                  <Database size={15} className="bucket-icon" />
                  <div className="bucket-info">
                    <span className="bucket-name">{b.name}</span>
                    <span className="bucket-meta">{count} file{count === 1 ? "" : "s"} · {formatBytes(size)}</span>
                  </div>
                  <button className="icon-btn bucket-delete" onClick={(e) => requestDeleteBucket(b, e)} aria-label={`Delete bucket ${b.name}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
            {isOwner && (newBucketDraft ? (
              <div className="inline-create-sm">
                <input autoFocus className="text-input" value={newBucketName} onChange={(e) => setNewBucketName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitNewBucket(); if (e.key === "Escape") { setNewBucketDraft(false); setNewBucketName(""); } }}
                  onBlur={commitNewBucket} placeholder="Bucket name" />
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setNewBucketDraft(true)}><Plus size={14} /> New bucket</button>
            ))}
          </div>
          <div className="capacity">
            <div className="capacity-labels"><span>{formatBytes(totalUsed)} used</span><span>{formatBytes(QUOTA_BYTES)}</span></div>
            <div className="capacity-bar"><div className="capacity-fill" style={{ width: `${usedPct}%`, background: usedPct > 85 ? "var(--danger)" : "var(--accent)" }} /></div>
          </div>
        </aside>

        {/* Main */}
        <section className="main" onDragOver={(e) => { e.preventDefault(); if (canEdit) setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={onDrop}>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />

          <div className="tabs-row">
            <button className={"tab-btn" + (mainTab === "files" ? " tab-btn-active" : "")} onClick={() => setMainTab("files")}>Files</button>
            <button className={"tab-btn" + (mainTab === "access" ? " tab-btn-active" : "")} onClick={() => setMainTab("access")}>
              <Users size={13} /> Access
            </button>
          </div>

          {mainTab === "access" ? (
            <AccessPanel
              bucketName={currentBucket.name}
              members={members}
              isOwner={isOwner}
              onRoleChange={setMemberRole}
              onRemove={removeMember}
              onAdd={addMember}
            />
          ) : (
            <>
              <div className="topbar">
                <div className="breadcrumb">
                  {breadcrumb.map((c, i) => (
                    <span key={c.id} className="crumb-wrap">
                      {i > 0 && <ChevronRight size={13} className="crumb-sep" />}
                      <button className={"crumb" + (i === breadcrumb.length - 1 ? " crumb-current" : "")} onClick={() => navigateToCrumb(i)}>{c.name}</button>
                    </span>
                  ))}
                </div>
                <div className="topbar-right">
                  <div className="search-box">
                    <Search size={14} />
                    <input className="search-input" placeholder="Search this bucket" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    {searchQuery && <button className="icon-btn" onClick={() => setSearchQuery("")}><X size={13} /></button>}
                  </div>
                  <div className="view-toggle">
                    <button className={"icon-btn" + (viewMode === "list" ? " icon-btn-active" : "")} onClick={() => setViewMode("list")} aria-label="List view"><ListIcon size={15} /></button>
                    <button className={"icon-btn" + (viewMode === "grid" ? " icon-btn-active" : "")} onClick={() => setViewMode("grid")} aria-label="Grid view"><LayoutGrid size={15} /></button>
                  </div>
                </div>
              </div>

              {canEdit ? (
                <div className="toolbar">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSearchQuery(""); setNewFolderDraft(true); }}><FolderPlus size={14} /> New folder</button>
                  <button className="btn btn-accent btn-sm" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Upload</button>
                </div>
              ) : (
                <div className="toolbar toolbar-readonly"><ShieldAlert size={13} /> Viewer access — read only</div>
              )}

              {(
                <div className={"selection-bar" + (selectedIds.size === 0 ? " selection-bar-idle" : "")} aria-hidden={selectedIds.size === 0}>
                  <span>{selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected</span>
                  <div className="selection-actions">
                    {canEdit && (
                      <button className="btn btn-ghost btn-sm" onClick={() => requestDeleteIds([...selectedIds], `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}`)}>
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}><X size={14} /> Clear</button>
                  </div>
                </div>
              )}

              <div className="content-scroll">
                {viewMode === "list" ? (
                  <table className="file-table">
                    <thead>
                      <tr>
                        <th className="col-check"><input type="checkbox" checked={displayItems.length > 0 && displayItems.every((i) => selectedIds.has(i.id))} onChange={toggleSelectAll} /></th>
                        <SortHeader label="Name" col="name" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                        <SortHeader label="Size" col="size" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="right" />
                        <SortHeader label="Modified" col="modified" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                        <SortHeader label="Type" col="type" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                        <th className="col-actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {newFolderDraft && (
                        <tr className="row">
                          <td className="col-check" />
                          <td colSpan={4}>
                            <div className="row-name">
                              <Folder size={16} className="row-icon" />
                              <input autoFocus className="text-input text-input-inline" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") commitNewFolder(); if (e.key === "Escape") { setNewFolderDraft(false); setNewFolderName(""); } }}
                                onBlur={commitNewFolder} placeholder="Folder name" />
                            </div>
                          </td>
                          <td />
                        </tr>
                      )}
                      {displayItems.map((item) => {
                        const Icon = item.type === "folder" ? Folder : getFileIcon(item.name);
                        const selected = selectedIds.has(item.id);
                        const isRenaming = renamingId === item.id;
                        return (
                          <tr key={item.id} className={"row" + (selected ? " row-selected" : "")} tabIndex={0}
                            onClick={() => selectOnly(item.id)}
                            onDoubleClick={() => (item.type === "folder" ? navigateTo(item.id) : setPreviewNode(item))}
                            onKeyDown={(e) => { if (e.key === "Enter") selectOnly(item.id); }}>
                            <td className="col-check"><input type="checkbox" checked={selected} onChange={(e) => toggleSelect(item.id, e)} /></td>
                            <td>
                              <div className="row-name">
                                <Icon size={16} className="row-icon" />
                                {isRenaming ? (
                                  <input autoFocus className="text-input text-input-inline" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                                    onBlur={commitRename} />
                                ) : (
                                  <span className="row-name-text" title={item.name}>{item.name}</span>
                                )}
                                {item.type === "file" && item.versions && item.versions.length > 0 && (
                                  <span className="version-badge" title={`${item.versions.length + 1} versions`}><Clock size={10} /> v{item.versions.length + 1}</span>
                                )}
                                {item.shared && <span className="shared-badge" title="Shared"><Share2 size={11} /></span>}
                                {item.__pathNames && item.__pathNames.length > 0 && <span className="row-path-hint">in /{item.__pathNames.join("/")}</span>}
                              </div>
                            </td>
                            <td className="mono col-size">{item.type === "file" ? formatBytes(item.size) : "—"}</td>
                            <td className="mono">{formatDate(item.modified)}</td>
                            <td className="text-muted">{getKind(item)}</td>
                            <td className="col-actions">
                              <div className="row-actions">
                                {item.type === "file" && (
                                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setPreviewNode(item); }} aria-label="Preview"><Eye size={13} /></button>
                                )}
                                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setShareNode(item); }} aria-label="Share"><Share2 size={13} /></button>
                                {canEdit && (
                                  <button className="icon-btn icon-btn-danger" onClick={(e) => { e.stopPropagation(); requestDeleteIds([item.id], `"${item.name}"`); }} aria-label="Delete"><Trash2 size={13} /></button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="grid-view">
                    {displayItems.map((item) => {
                      const Icon = item.type === "folder" ? Folder : getFileIcon(item.name);
                      const selected = selectedIds.has(item.id);
                      return (
                        <div key={item.id} className={"tile" + (selected ? " tile-selected" : "")} onClick={() => selectOnly(item.id)}
                          onDoubleClick={() => (item.type === "folder" ? navigateTo(item.id) : setPreviewNode(item))} tabIndex={0}>
                          <input type="checkbox" className="tile-check" checked={selected} onChange={(e) => toggleSelect(item.id, e)} onClick={(e) => e.stopPropagation()} />
                          {item.shared && <span className="tile-shared"><Share2 size={11} /></span>}
                          <Icon size={30} className="tile-icon" />
                          <span className="tile-name" title={item.name}>{item.name}</span>
                          <span className="tile-meta mono">{item.type === "file" ? formatBytes(item.size) : `${item.children.length} items`}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {displayItems.length === 0 && !newFolderDraft && (
                  <div className="empty-state">
                    {searchQuery ? (
                      <><Search size={32} strokeWidth={1.4} /><p className="empty-title">No matches for "{searchQuery}"</p><p className="empty-sub">Try a different search term.</p></>
                    ) : (
                      <><Upload size={32} strokeWidth={1.4} /><p className="empty-title">This folder is empty</p><p className="empty-sub">{canEdit ? "Drag files here or use Upload to add some." : "Nothing here yet."}</p></>
                    )}
                  </div>
                )}
              </div>

              {isDragging && canEdit && <div className="drop-overlay"><Upload size={36} strokeWidth={1.3} /><span>Drop files to upload</span></div>}

              {uploadQueue.length > 0 && (
                <div className="upload-tray">
                  {uploadQueue.map((u) => (
                    <div key={u.id} className="upload-item">
                      <span className="upload-name" title={u.name}>{u.name}</span>
                      <div className="upload-bar"><div className="upload-bar-fill" style={{ width: `${u.progress}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Details panel */}
        {mainTab === "files" && selectedNode && (
          <aside className="details">
            <div className="details-header"><span>Details</span><button className="icon-btn" onClick={() => setSelectedIds(new Set())} aria-label="Close"><X size={14} /></button></div>
            <div className="details-icon-block"><IconForSelected size={34} strokeWidth={1.4} /></div>
            <p className="details-name" title={selectedNode.name}>{selectedNode.name}</p>
            <div className="details-rows">
              <DetailRow label="Type" value={getKind(selectedNode)} />
              {selectedNode.type === "file" ? <DetailRow label="Size" value={formatBytes(selectedNode.size)} mono /> : (
                <>
                  <DetailRow label="Items" value={String(selectedNode.children.length)} mono />
                  <DetailRow label="Total size" value={formatBytes(calcSize(selectedNode))} mono />
                </>
              )}
              <DetailRow label="Modified" value={formatDate(selectedNode.modified, true)} mono />
              <DetailRow label="Sharing" value={selectedNode.shared ? "Link enabled" : "Private"} />
            </div>

            {selectedNode.type === "file" && (
              <div className="version-history">
                <div className="version-history-title"><Clock size={12} /> Version history</div>
                <div className="version-row version-row-current">
                  <span>v{(selectedNode.versions?.length || 0) + 1} · current</span>
                  <span className="mono text-muted">{formatBytes(selectedNode.size)}</span>
                </div>
                {(selectedNode.versions || []).map((v, idx) => (
                  <div className="version-row" key={v.id}>
                    <span>v{(selectedNode.versions.length - idx)}</span>
                    <span className="mono text-muted">{formatBytes(v.size)} · {formatDate(v.modified)}</span>
                    {canEdit && <button className="icon-btn" onClick={() => restoreVersion(selectedNode, v)} aria-label="Restore this version"><RotateCcw size={12} /></button>}
                  </div>
                ))}
                {(!selectedNode.versions || selectedNode.versions.length === 0) && <p className="version-empty">Only one version so far. Upload a file with the same name to create a new one.</p>}
              </div>
            )}

            <div className="details-actions">
              {selectedNode.type === "file" && <button className="btn btn-ghost btn-sm" onClick={() => setPreviewNode(selectedNode)}><Eye size={14} /> Preview</button>}
              {selectedNode.type === "file" && <button className="btn btn-ghost btn-sm" onClick={() => attemptDownload(selectedNode)}><Download size={14} /> Download</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setShareNode(selectedNode)}><Share2 size={14} /> Share</button>
              {canEdit && <button className="btn btn-ghost btn-sm" onClick={(e) => startRename(selectedNode, e)}><Pencil size={14} /> Rename</button>}
              {canEdit && <button className="btn btn-danger btn-sm" onClick={() => requestDeleteIds([selectedNode.id], `"${selectedNode.name}"`)}><Trash2 size={14} /> Delete</button>}
            </div>
          </aside>
        )}
      </div>

      {confirmAction && (
        <div className="modal-backdrop" onClick={() => setConfirmAction(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-message">{confirmAction.message}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={confirmAction.onConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {previewNode && <PreviewModal node={previewNode} onClose={() => setPreviewNode(null)} onDownload={attemptDownload} />}

      {shareNode && (
        <ShareModal
          node={findNodeById(currentBucket.root, shareNode.id) || shareNode}
          members={members}
          canEdit={canEdit}
          bucketId={currentBucket.id}
          onClose={() => setShareNode(null)}
          onToggleShared={(shared) => mutateNode(shareNode.id, (n) => ({ ...n, shared }))}
          onAddCollaborator={(email, role) => mutateNode(shareNode.id, (n) => ({ ...n, sharedWith: [...(n.sharedWith || []), { id: uid(), email, role }] }))}
          onRemoveCollaborator={(id) => mutateNode(shareNode.id, (n) => ({ ...n, sharedWith: (n.sharedWith || []).filter((c) => c.id !== id) }))}
          onCopyLink={() => showToast("Link copied to clipboard")}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          backendConfig={backendConfig}
          setBackendConfig={setBackendConfig}
          onClose={() => setSettingsOpen(false)}
          onResetDemo={resetDemoData}
          showToast={showToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </StorageShell>
  );
}

// ================= subcomponents =================

function SortHeader({ label, col, sortBy, sortDir, onClick, align }) {
  const active = sortBy === col;
  return (
    <th className={align === "right" ? "text-right" : ""}>
      <button className="sort-btn" onClick={() => onClick(col)}>
        {label}
        {active && (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={"detail-value" + (mono ? " mono" : "")}>{value}</span>
    </div>
  );
}

function AccessPanel({ bucketName, members, isOwner, onRoleChange, onRemove, onAdd }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  return (
    <div className="access-panel">
      <h3 className="access-title">Members of "{bucketName}"</h3>
      <p className="access-sub">People with access to this bucket and what they can do.</p>
      <table className="access-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td className="mono text-muted">{m.email}</td>
              <td>
                <select value={m.role} disabled={!isOwner} onChange={(e) => onRoleChange(m.id, e.target.value)} className="role-select">
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </td>
              <td>{isOwner && <button className="icon-btn icon-btn-danger" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.name}`}><Trash2 size={13} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner && (
        <div className="invite-row">
          <input className="text-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="role-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
          <button className="btn btn-accent btn-sm" onClick={() => { if (email.trim()) { onAdd(name, email, role); setName(""); setEmail(""); setRole("viewer"); } }}>
            <Plus size={14} /> Invite
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewModal({ node, onClose, onDownload }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const ext = getExt(node.name);
  const isImage = IMAGE_EXT.includes(ext);
  const isTextPreview = TEXT_PREVIEW_EXT.includes(ext);

  useEffect(() => {
    setText(null);
    if (isTextPreview && node.fileObj) {
      setLoading(true);
      const reader = new FileReader();
      reader.onload = () => { setText(String(reader.result).slice(0, 6000)); setLoading(false); };
      reader.onerror = () => { setLoading(false); };
      reader.readAsText(node.fileObj);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span title={node.name}>{node.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="preview-body">
          {isImage && node.fileObj && <img className="preview-image" src={URL.createObjectURL(node.fileObj)} alt={node.name} />}
          {isImage && !node.fileObj && <PreviewFallback message="Preview not available for demo files — upload your own image to see it here." />}
          {isTextPreview && node.fileObj && (loading ? <p className="text-muted">Reading file…</p> : <pre className="preview-text mono">{text}</pre>)}
          {isTextPreview && !node.fileObj && <PreviewFallback message="Preview not available for demo files — upload a real file with this name to preview its contents." />}
          {!isImage && !isTextPreview && <PreviewFallback message="No inline preview for this file type." />}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-accent btn-sm" onClick={() => onDownload(node)}><Download size={14} /> Download</button>
        </div>
      </div>
    </div>
  );
}

function PreviewFallback({ message }) {
  return (
    <div className="preview-fallback">
      <File size={32} strokeWidth={1.4} />
      <p>{message}</p>
    </div>
  );
}

function ShareModal({ node, members, canEdit, onClose, onToggleShared, onAddCollaborator, onRemoveCollaborator, onCopyLink }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const link = `https://datavault.example.com/s/${node.id.slice(0, 8)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      onCopyLink();
    } catch (e) {
      onCopyLink();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><span>Share "{node.name}"</span><button className="icon-btn" onClick={onClose}><X size={15} /></button></div>

        <label className="share-toggle">
          <input type="checkbox" checked={!!node.shared} disabled={!canEdit} onChange={(e) => onToggleShared(e.target.checked)} />
          <span>Anyone with the link can view</span>
        </label>

        {node.shared && (
          <div className="share-link-row">
            <input className="text-input mono" value={link} readOnly />
            <button className="btn btn-ghost btn-sm" onClick={copyLink}><Link2 size={13} /> Copy</button>
          </div>
        )}

        <div className="share-section-title">People with access</div>
        <div className="share-people">
          {members.map((m) => (
            <div className="share-person" key={m.id}>
              <span>{m.name}</span>
              <span className="text-muted">inherits {m.role} role</span>
            </div>
          ))}
          {(node.sharedWith || []).map((c) => (
            <div className="share-person" key={c.id}>
              <span>{c.email}</span>
              <span className="text-muted">{c.role}</span>
              {canEdit && <button className="icon-btn" onClick={() => onRemoveCollaborator(c.id)} aria-label="Remove"><X size={12} /></button>}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="invite-row">
            <input className="text-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="role-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button className="btn btn-accent btn-sm" onClick={() => { if (email.trim()) { onAddCollaborator(email.trim(), role); setEmail(""); } }}>Add</button>
          </div>
        )}

        <div className="modal-actions"><button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function SettingsModal({ backendConfig, setBackendConfig, onClose, onResetDemo, showToast }) {
  const [testing, setTesting] = useState(false);
  const [showContract, setShowContract] = useState(false);

  const test = async () => {
    if (!backendConfig.baseUrl.trim()) { setBackendConfig((bc) => ({ ...bc, status: "error", statusMessage: "Enter a base URL first" })); return; }
    setTesting(true);
    try {
      await restTestConnection(backendConfig.baseUrl, backendConfig.apiKey);
      setBackendConfig((bc) => ({ ...bc, status: "connected", statusMessage: "Connected" }));
    } catch (e) {
      setBackendConfig((bc) => ({ ...bc, status: "error", statusMessage: e.message || "Could not reach API" }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><span>Settings</span><button className="icon-btn" onClick={onClose}><X size={15} /></button></div>

        <div className="settings-section">
          <div className="settings-label">Storage backend</div>
          <div className="backend-mode-toggle">
            <button className={"tab-btn" + (backendConfig.mode === "demo" ? " tab-btn-active" : "")} onClick={() => setBackendConfig((bc) => ({ ...bc, mode: "demo" }))}>Demo (local)</button>
            <button className={"tab-btn" + (backendConfig.mode === "rest" ? " tab-btn-active" : "")} onClick={() => setBackendConfig((bc) => ({ ...bc, mode: "rest" }))}>REST API</button>
          </div>

          {backendConfig.mode === "demo" ? (
            <p className="settings-note">Files live in this browser only, saved via the Artifacts storage API so they survive a refresh. Nothing leaves your device.</p>
          ) : (
            <>
              <p className="settings-note">
                Point this at your own backend — typically a small server that issues presigned upload URLs for S3, GCS, or Azure Blob. Never put cloud provider secret keys directly in this browser app.
              </p>
              <label className="settings-field">
                <span>Base URL</span>
                <input className="text-input" placeholder="https://api.yourapp.com" value={backendConfig.baseUrl} onChange={(e) => setBackendConfig((bc) => ({ ...bc, baseUrl: e.target.value, status: "idle" }))} />
              </label>
              <label className="settings-field">
                <span>API key (optional)</span>
                <input className="text-input" type="password" autoComplete="off" placeholder="Bearer token" value={backendConfig.apiKey} onChange={(e) => setBackendConfig((bc) => ({ ...bc, apiKey: e.target.value, status: "idle" }))} />
              </label>
              <div className="settings-test-row">
                <button className="btn btn-ghost btn-sm" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
                {backendConfig.status !== "idle" && (
                  <span className={backendConfig.status === "connected" ? "status-ok" : backendConfig.status === "error" ? "status-bad" : "text-muted"}>
                    {backendConfig.statusMessage}
                  </span>
                )}
              </div>
              <button className="link-btn" onClick={() => setShowContract((s) => !s)}>{showContract ? "Hide" : "Show"} API contract</button>
              {showContract && <pre className="api-contract mono">{API_CONTRACT}</pre>}
            </>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-label">Demo data</div>
          <button className="btn btn-ghost btn-sm" onClick={onResetDemo}><RotateCcw size={13} /> Reset to demo data</button>
        </div>

        <div className="modal-actions"><button className="btn btn-accent btn-sm" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function StorageShell({ children }) {
  return (
    <div className="app-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        .app-shell, .app-shell * { box-sizing: border-box; }
        .app-shell {
          --bg: #0F1115;
          --surface: #171A20;
          --surface-2: #1D2128;
          --border: #262B33;
          --border-strong: #333947;
          --text: #E7E9EC;
          --text-muted: #8A93A3;
          --text-faint: #5B6472;
          --accent: #F2A93B;
          --accent-soft: rgba(242,169,59,0.14);
          --danger: #E5484D;
          --danger-soft: rgba(229,72,77,0.14);
          --success: #4ADE80;
          font-family: 'IBM Plex Sans', sans-serif;
          background: var(--bg);
          color: var(--text);
          display: flex;
          flex-direction: column;
          height: 660px;
          max-height: 88vh;
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
          position: relative;
          font-size: 13.5px;
        }
        .mono { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; }
        .text-muted { color: var(--text-muted); }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
        *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

        .loading-screen { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-muted); }

        .top-strip { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .brand { display: flex; align-items: center; gap: 7px; font-weight: 600; color: var(--accent); }
        .top-strip-right { display: flex; align-items: center; gap: 14px; }
        .role-switch { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
        .role-switch select { background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
        .backend-pill { font-size: 11px; padding: 3px 9px; border-radius: 20px; border: 1px solid var(--border-strong); color: var(--text-muted); }
        .backend-ok { color: var(--success); border-color: var(--success); }
        .backend-bad { color: var(--danger); border-color: var(--danger); }

        .body-row { flex: 1; display: flex; min-height: 0; }

        .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); padding: 7px 12px; border-radius: 5px; font-size: 13px; font-weight: 500; transition: border-color .12s, background .12s; }
        .btn:hover { border-color: var(--accent); }
        .btn:disabled { opacity: .5; }
        .btn-sm { padding: 5px 10px; font-size: 12.5px; }
        .btn-ghost { background: transparent; }
        .btn-accent { background: var(--accent); color: #201404; border-color: var(--accent); }
        .btn-accent:hover { filter: brightness(1.08); }
        .btn-danger { background: transparent; border-color: var(--border-strong); color: #F3A5A7; }
        .btn-danger:hover { border-color: var(--danger); background: var(--danger-soft); }
        .link-btn { background: none; border: none; color: var(--accent); font-size: 12px; padding: 4px 0; text-align: left; }

        .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; background: transparent; color: var(--text-muted); border-radius: 4px; transition: background .12s, color .12s; }
        .icon-btn:hover { background: var(--surface-2); color: var(--text); }
        .icon-btn:disabled { opacity: 0.25; cursor: default; }
        .icon-btn-active { background: var(--accent-soft); color: var(--accent); }
        .icon-btn-danger:hover { background: var(--danger-soft); color: var(--danger); }

        .text-input { background: var(--surface-2); border: 1px solid var(--accent); color: var(--text); border-radius: 4px; padding: 5px 8px; font-size: 13px; width: 100%; }
        .text-input-inline { padding: 3px 6px; }
        .role-select { background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text); border-radius: 4px; padding: 4px 6px; font-size: 12px; }

        /* Sidebar */
        .sidebar { width: 230px; min-width: 230px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .bucket-list { flex: 1; overflow-y: auto; padding: 8px 8px 4px; }
        .bucket-row { display: flex; align-items: center; gap: 8px; padding: 8px 8px; border-radius: 5px; cursor: pointer; position: relative; }
        .bucket-row:hover { background: var(--surface-2); }
        .bucket-row-active { background: var(--accent-soft); }
        .bucket-row-active .bucket-icon { color: var(--accent); }
        .bucket-icon { color: var(--text-muted); flex-shrink: 0; }
        .bucket-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .bucket-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bucket-meta { font-size: 11px; color: var(--text-muted); font-family: 'IBM Plex Mono', monospace; }
        .bucket-delete { opacity: 0; flex-shrink: 0; }
        .bucket-row:hover .bucket-delete { opacity: 1; }
        .inline-create-sm { padding: 4px 4px; }
        .btn-sm.btn-ghost { color: var(--text-muted); margin: 4px 4px 0; }

        .capacity { padding: 12px 16px 16px; border-top: 1px solid var(--border); }
        .capacity-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); font-family: 'IBM Plex Mono', monospace; margin-bottom: 6px; }
        .capacity-bar { height: 5px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
        .capacity-fill { height: 100%; border-radius: 3px; transition: width .3s ease; }

        /* Main */
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
        .tabs-row { display: flex; gap: 4px; padding: 10px 16px 0; flex-shrink: 0; }
        .tab-btn { background: none; border: none; color: var(--text-muted); font-size: 12.5px; font-weight: 500; padding: 7px 12px; border-radius: 5px 5px 0 0; display: inline-flex; align-items: center; gap: 5px; border-bottom: 2px solid transparent; }
        .tab-btn:hover { color: var(--text); }
        .tab-btn-active { color: var(--accent); border-bottom-color: var(--accent); }

        .topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border); gap: 12px; }
        .breadcrumb { display: flex; align-items: center; min-width: 0; overflow: hidden; }
        .crumb-wrap { display: flex; align-items: center; }
        .crumb-sep { color: var(--text-faint); margin: 0 2px; }
        .crumb { background: none; border: none; color: var(--text-muted); padding: 3px 4px; border-radius: 4px; font-size: 13.5px; white-space: nowrap; }
        .crumb:hover { background: var(--surface-2); color: var(--text); }
        .crumb-current { color: var(--text); font-weight: 600; }
        .topbar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .search-box { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 5px; padding: 5px 8px; color: var(--text-muted); width: 190px; }
        .search-input { background: none; border: none; color: var(--text); flex: 1; min-width: 0; font-size: 13px; }
        .search-input::placeholder { color: var(--text-faint); }
        .view-toggle { display: flex; gap: 2px; background: var(--surface-2); border-radius: 5px; padding: 2px; }

        .toolbar { display: flex; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
        .toolbar-readonly { align-items: center; gap: 6px; color: var(--text-muted); font-size: 12.5px; }

        .selection-bar-idle { visibility: hidden; }
        .selection-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: var(--accent-soft); border-bottom: 1px solid var(--border); font-size: 12.5px; color: var(--accent); }
        .selection-actions { display: flex; gap: 6px; }

        .content-scroll { flex: 1; overflow-y: auto; }

        .file-table { width: 100%; border-collapse: collapse; }
        .file-table thead th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 1; }
        .sort-btn { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--text-muted); font-size: 11.5px; font-weight: 600; }
        .sort-btn:hover { color: var(--text); }
        .text-right { text-align: right; }
        .col-check { width: 34px; padding-left: 14px !important; }
        .col-size { text-align: right; }
        .col-actions { width: 110px; }
        .row { border-bottom: 1px solid var(--border); }
        .row:hover { background: var(--surface); }
        .row-selected { background: var(--accent-soft) !important; }
        .row td { padding: 7px 12px; }
        .row-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .row-icon { color: var(--text-muted); flex-shrink: 0; }
        .row-name-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .row-path-hint { font-size: 11px; color: var(--text-faint); font-family: 'IBM Plex Mono', monospace; flex-shrink: 0; }
        .row-actions { display: flex; gap: 2px; opacity: 0; justify-content: flex-end; }
        .row:hover .row-actions, .row-selected .row-actions { opacity: 1; }
        .version-badge { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; color: var(--text-muted); background: var(--surface-2); border-radius: 8px; padding: 1px 6px; flex-shrink: 0; }
        .shared-badge { color: var(--accent); flex-shrink: 0; display: inline-flex; }

        .grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 4px; padding: 14px; }
        .tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 10px; border-radius: 6px; border: 1px solid transparent; text-align: center; }
        .tile:hover { background: var(--surface); }
        .tile-selected { background: var(--accent-soft); border-color: var(--accent); }
        .tile-icon { color: var(--text-muted); }
        .tile-name { font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tile-meta { font-size: 10.5px; color: var(--text-muted); }
        .tile-check { position: absolute; top: 6px; left: 6px; opacity: 0; }
        .tile:hover .tile-check, .tile-selected .tile-check { opacity: 1; }
        .tile-shared { position: absolute; top: 6px; right: 6px; color: var(--accent); }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 60px 20px; color: var(--text-muted); text-align: center; }
        .empty-title { color: var(--text); font-weight: 500; margin: 6px 0 0; }
        .empty-sub { font-size: 12.5px; margin: 0; }
        .inline-create { margin-top: 10px; width: 220px; }

        .drop-overlay { position: absolute; inset: 0; background: rgba(15,17,21,0.9); border: 2px dashed var(--accent); margin: 8px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--accent); font-weight: 500; pointer-events: none; }

        .upload-tray { position: absolute; bottom: 12px; right: 12px; width: 240px; display: flex; flex-direction: column; gap: 6px; }
        .upload-item { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px; padding: 8px 10px; }
        .upload-name { display: block; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px; }
        .upload-bar { height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
        .upload-bar-fill { height: 100%; background: var(--accent); transition: width .15s linear; }

        /* Details panel */
        .details { width: 260px; min-width: 260px; border-left: 1px solid var(--border); background: var(--surface); padding: 14px; display: flex; flex-direction: column; overflow-y: auto; }
        .details-header { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--text-muted); font-weight: 600; letter-spacing: 0.02em; margin-bottom: 10px; }
        .details-icon-block { display: flex; justify-content: center; padding: 14px 0 8px; color: var(--accent); }
        .details-name { text-align: center; font-weight: 500; word-break: break-word; margin: 0 0 14px; }
        .details-rows { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
        .detail-row { display: flex; justify-content: space-between; font-size: 12px; }
        .detail-label { color: var(--text-muted); }
        .detail-value { max-width: 60%; text-align: right; word-break: break-word; }

        .version-history { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 12px; }
        .version-history-title { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; text-transform: none; }
        .version-row { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; padding: 5px 0; gap: 6px; }
        .version-row-current { color: var(--accent); }
        .version-empty { font-size: 11.5px; color: var(--text-faint); margin: 4px 0 0; }

        .details-actions { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; padding-top: 14px; border-top: 1px solid var(--border); }
        .details-actions .btn { justify-content: flex-start; }

        /* Access panel */
        .access-panel { padding: 20px; overflow-y: auto; }
        .access-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
        .access-sub { margin: 0 0 16px; font-size: 12.5px; color: var(--text-muted); }
        .access-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        .access-table th { text-align: left; font-size: 11px; color: var(--text-muted); font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--border); }
        .access-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
        .invite-row { display: flex; gap: 8px; align-items: center; }
        .invite-row .text-input { width: 160px; }

        /* Modals */
        .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
        .modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 7px; padding: 18px; width: 300px; }
        .modal-lg { width: 380px; max-height: 480px; overflow-y: auto; }
        .modal-header { display: flex; align-items: center; justify-content: space-between; font-weight: 600; margin-bottom: 14px; }
        .modal-message { margin: 0 0 16px; font-size: 13.5px; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

        .preview-body { min-height: 140px; display: flex; align-items: center; justify-content: center; background: var(--surface-2); border-radius: 6px; padding: 10px; }
        .preview-image { max-width: 100%; max-height: 260px; border-radius: 4px; }
        .preview-text { max-height: 260px; overflow: auto; width: 100%; white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 11.5px; }
        .preview-fallback { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-muted); text-align: center; padding: 20px; font-size: 12.5px; }

        .share-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 10px; }
        .share-link-row { display: flex; gap: 8px; margin-bottom: 16px; }
        .share-section-title { font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; }
        .share-people { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .share-person { display: flex; align-items: center; gap: 8px; font-size: 12.5px; justify-content: space-between; }

        .settings-section { border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; }
        .settings-section:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
        .settings-label { font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 10px; }
        .backend-mode-toggle { display: flex; gap: 6px; margin-bottom: 10px; }
        .backend-mode-toggle .tab-btn { background: var(--surface-2); border-radius: 5px; border-bottom: none; }
        .settings-note { font-size: 12px; color: var(--text-muted); margin: 0 0 12px; line-height: 1.5; }
        .settings-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
        .settings-test-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .status-ok { color: var(--success); font-size: 12px; }
        .status-bad { color: var(--danger); font-size: 12px; }
        .api-contract { background: var(--bg); border: 1px solid var(--border); border-radius: 5px; padding: 10px; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; margin-top: 8px; }

        .toast { position: absolute; bottom: 16px; left: 16px; background: var(--surface); border: 1px solid var(--border-strong); color: var(--text); padding: 8px 14px; border-radius: 6px; font-size: 12.5px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 20; }

        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }

        @media (prefers-reduced-motion: reduce) { .app-shell * { transition: none !important; animation: none !important; } }

        @media (max-width: 760px) {
          .app-shell { height: 88vh; }
          .top-strip { flex-wrap: wrap; gap: 8px; }
          .body-row { flex-direction: column; }
          .sidebar { width: 100%; min-width: 0; flex-direction: row; align-items: center; border-right: none; border-bottom: 1px solid var(--border); }
          .bucket-list { display: flex; flex-direction: row; overflow-x: auto; flex: none; }
          .bucket-row { flex-shrink: 0; }
          .capacity { display: none; }
          .details { width: 100%; min-width: 0; border-left: none; border-top: 1px solid var(--border); }
          .search-box { width: 130px; }
        }
      `}</style>
      {children}
    </div>
  );
}

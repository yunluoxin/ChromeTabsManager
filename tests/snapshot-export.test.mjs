import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_EXPORT_FORMAT,
  SNAPSHOT_EXPORT_VERSION,
  buildSnapshotExport,
  captureSnapshot,
  parseSnapshotImport,
  snapshotExportFileName
} from "../src/tab-snapshot.js";

function makeSnapshot() {
  const tabs = [
    { windowId: 1, index: 0, url: "https://a.com", title: "A", active: true, pinned: false },
    { windowId: 1, index: 1, url: "https://b.com", title: "B", active: false, pinned: true },
    { windowId: 2, index: 0, url: "https://c.com", title: "C", active: true, pinned: false }
  ];
  return captureSnapshot(tabs, [{ id: 1 }, { id: 2 }], 1720954200000);
}

test("buildSnapshotExport wraps snapshots in the versioned envelope", () => {
  const snap = makeSnapshot();
  const doc = buildSnapshotExport([snap], 1720954300000);

  assert.equal(doc.format, SNAPSHOT_EXPORT_FORMAT);
  assert.equal(doc.version, SNAPSHOT_EXPORT_VERSION);
  assert.equal(doc.exportedAt, 1720954300000);
  assert.equal(doc.snapshots.length, 1);
  assert.equal(doc.snapshots[0].id, snap.id);
});

test("snapshotExportFileName uses the snapshot's own time for single exports", () => {
  const snap = makeSnapshot();
  const name = snapshotExportFileName([snap], 1720954300000);
  const d = new Date(1720954200000);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  assert.equal(name, `tab-snapshot-${stamp}.json`);
});

test("snapshotExportFileName pluralizes for batch exports", () => {
  const a = makeSnapshot();
  const b = { ...makeSnapshot(), id: "snap-1", createdAt: 1720954300000 };
  assert.match(snapshotExportFileName([a, b], 1720954400000), /^tab-snapshots-\d{8}-\d{4}\.json$/);
});

test("parseSnapshotImport round-trips an export", () => {
  const snap = makeSnapshot();
  const json = JSON.stringify(buildSnapshotExport([snap], 1720954300000));
  const result = parseSnapshotImport(json, { createdAt: 999 });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  const restored = result.snapshots[0];
  assert.equal(restored.id, snap.id); // id free → reused
  assert.equal(restored.windowCount, 2);
  assert.equal(restored.tabCount, 3);
  assert.deepEqual(restored.windows, snap.windows);
});

test("parseSnapshotImport regenerates colliding ids", () => {
  const snap = makeSnapshot();
  const json = JSON.stringify(buildSnapshotExport([snap]));
  const result = parseSnapshotImport(json, {
    existingIds: new Set([snap.id]),
    createdAt: 5000
  });

  assert.equal(result.imported, 1);
  assert.notEqual(result.snapshots[0].id, snap.id);
  assert.equal(result.snapshots[0].id, "snap-5000");
});

test("parseSnapshotImport drops non-capturable tabs and empty windows", () => {
  const doc = buildSnapshotExport([{
    id: "snap-x",
    createdAt: 100,
    label: "test",
    windows: [
      { activeIndex: 0, tabs: [{ url: "chrome://extensions", title: "chrome" }] },
      {
        activeIndex: 0,
        tabs: [
          { url: "chrome-extension://abc/page.html", title: "ext" },
          { url: "https://keep.com", title: "Keep" }
        ]
      }
    ]
  }]);
  const result = parseSnapshotImport(JSON.stringify(doc), { createdAt: 1 });

  assert.equal(result.imported, 1);
  const restored = result.snapshots[0];
  assert.equal(restored.windowCount, 1); // chrome://-only window vanished
  assert.equal(restored.tabCount, 1);
  assert.equal(restored.windows[0].tabs[0].url, "https://keep.com");
});

test("parseSnapshotImport skips malformed snapshots but keeps valid ones", () => {
  const snap = makeSnapshot();
  const doc = {
    format: SNAPSHOT_EXPORT_FORMAT,
    version: 1,
    snapshots: [null, { windows: [] }, snap]
  };
  const result = parseSnapshotImport(JSON.stringify(doc), { createdAt: 1 });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
});

test("parseSnapshotImport rejects bad JSON, wrong format, and empty files", () => {
  assert.throws(() => parseSnapshotImport("not json"), /JSON/);
  assert.throws(
    () => parseSnapshotImport(JSON.stringify({ format: "other", snapshots: [] })),
    /快照导出文件/
  );
  assert.throws(
    () => parseSnapshotImport(JSON.stringify(buildSnapshotExport([]))),
    /没有快照/
  );
  assert.throws(
    () => parseSnapshotImport(JSON.stringify({ format: SNAPSHOT_EXPORT_FORMAT, snapshots: [{ windows: [] }] })),
    /不可导入/
  );
});

test("parseSnapshotImport fills missing label and createdAt", () => {
  const doc = {
    format: SNAPSHOT_EXPORT_FORMAT,
    version: 1,
    snapshots: [{
      windows: [{ activeIndex: 0, tabs: [{ url: "https://a.com" }] }]
    }]
  };
  const result = parseSnapshotImport(JSON.stringify(doc), { createdAt: 42 });

  const restored = result.snapshots[0];
  assert.equal(restored.label, "导入的快照");
  assert.equal(restored.createdAt, 42);
  assert.equal(restored.id, "snap-42");
});

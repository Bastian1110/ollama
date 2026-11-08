import { describe, expect, it } from "vitest";
import { ChatInfo, FolderInfo } from "@/gotypes";
import { buildChatMenu, groupChatsByFolder } from "./chatFolders";

const folder = (id: string, name: string) =>
  new FolderInfo({ id, name, createdAt: "2026-01-01T00:00:00Z" });

const chat = (id: string, folderId?: string) =>
  new ChatInfo({
    id,
    title: id,
    userExcerpt: "",
    folderId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });

describe("groupChatsByFolder", () => {
  it("places chats in their folders and keeps the rest unfiled", () => {
    const folders = [folder("a", "Alpha"), folder("b", "Beta")];
    const chats = [chat("1", "b"), chat("2"), chat("3", "b"), chat("4", "a")];

    const { folderGroups, unfiled } = groupChatsByFolder(chats, folders);

    expect(
      folderGroups.map((g) => [g.folder.id, g.chats.map((c) => c.id)]),
    ).toEqual([
      ["a", ["4"]],
      ["b", ["1", "3"]],
    ]);
    expect(unfiled.map((c) => c.id)).toEqual(["2"]);
  });

  it("keeps empty folders and unfiles chats of unknown folders", () => {
    const { folderGroups, unfiled } = groupChatsByFolder(
      [chat("1", "gone")],
      [folder("a", "Alpha")],
    );

    expect(folderGroups).toHaveLength(1);
    expect(folderGroups[0].chats).toEqual([]);
    expect(unfiled.map((c) => c.id)).toEqual(["1"]);
  });
});

describe("buildChatMenu", () => {
  it("offers every other folder and removal from the current one", () => {
    const folders = [folder("a", "Alpha"), folder("b", "Beta")];

    const { items, actions } = buildChatMenu(folders, "a");

    expect(items.map((i) => i.label)).toEqual([
      "Rename",
      "Delete",
      "",
      "New folder…",
      "Move to “Beta”",
      "Remove from folder",
    ]);
    expect(actions.get("Move to “Beta”")).toEqual({
      type: "move",
      folderId: "b",
    });
    expect(actions.get("Remove from folder")).toEqual({
      type: "move",
      folderId: "",
    });
  });

  it("gives folders with the same name distinct labels", () => {
    const folders = [folder("a", "Work"), folder("b", "Work")];

    const { items, actions } = buildChatMenu(folders);

    const labels = items.filter((i) => !i.separator).map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(actions.get("Move to “Work”")).toEqual({
      type: "move",
      folderId: "a",
    });
    expect(actions.get("Move to “Work” (2)")).toEqual({
      type: "move",
      folderId: "b",
    });
    expect(labels).not.toContain("Remove from folder");
  });

  it("does not confuse folder names with built-in actions", () => {
    const { actions } = buildChatMenu([folder("a", "Delete")]);

    expect(actions.get("Delete")).toEqual({ type: "delete" });
    expect(actions.get("Move to “Delete”")).toEqual({
      type: "move",
      folderId: "a",
    });
  });
});

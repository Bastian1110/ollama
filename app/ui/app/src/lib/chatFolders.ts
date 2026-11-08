import type { ChatInfo, FolderInfo } from "@/gotypes";
import type { MenuItem } from "@/types/webview";

export interface FolderGroup {
  folder: FolderInfo;
  chats: ChatInfo[];
}

// groupChatsByFolder splits chats into their folders, keeping the order of
// both inputs. Chats that reference a folder that no longer exists are treated
// as unfiled so they never disappear from the sidebar.
export function groupChatsByFolder(
  chats: ChatInfo[],
  folders: FolderInfo[],
): { folderGroups: FolderGroup[]; unfiled: ChatInfo[] } {
  const byId = new Map<string, FolderGroup>(
    folders.map((folder) => [folder.id, { folder, chats: [] }]),
  );
  const unfiled: ChatInfo[] = [];

  for (const chat of chats) {
    const group = chat.folderId ? byId.get(chat.folderId) : undefined;
    if (group) {
      group.chats.push(chat);
    } else {
      unfiled.push(chat);
    }
  }

  return { folderGroups: [...byId.values()], unfiled };
}

export type ChatMenuAction =
  | { type: "rename" }
  | { type: "delete" }
  | { type: "newFolder" }
  // folderId is empty when removing the chat from its folder
  | { type: "move"; folderId: string };

export interface ContextMenu<A> {
  items: MenuItem[];
  // the native menu reports the selected label, so labels map back to actions
  actions: Map<string, A>;
}

// buildChatMenu builds the context menu for a chat. Every label is unique, even
// when folders share a name, so a selection maps to exactly one action.
export function buildChatMenu(
  folders: FolderInfo[],
  currentFolderId?: string,
): ContextMenu<ChatMenuAction> {
  const items: MenuItem[] = [];
  const actions = new Map<string, ChatMenuAction>();

  const add = (label: string, action: ChatMenuAction) => {
    let unique = label;
    for (let n = 2; actions.has(unique); n++) {
      unique = `${label} (${n})`;
    }
    items.push({ label: unique, enabled: true });
    actions.set(unique, action);
  };

  add("Rename", { type: "rename" });
  add("Delete", { type: "delete" });
  // the native bridge requires a label on every item, including separators
  items.push({ label: "", separator: true });
  add("New folder…", { type: "newFolder" });
  for (const folder of folders) {
    if (folder.id !== currentFolderId) {
      add(`Move to “${folder.name}”`, { type: "move", folderId: folder.id });
    }
  }
  if (currentFolderId && folders.some((f) => f.id === currentFolderId)) {
    add("Remove from folder", { type: "move", folderId: "" });
  }

  return { items, actions };
}

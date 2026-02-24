import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AVATAR_MAX_BYTES } from "../../lib/env";
import {
  clearCachedAvatar,
  loadCachedAvatar,
  saveCachedAvatar,
} from "../../lib/avatar";
import type { JoinResp, MessageItem } from "../../lib/types";

type ApiClient = ReturnType<typeof import("../../lib/api").createApi>;

export type AvatarStatus = {
  kind: "idle" | "ok" | "error";
  text: string;
};

type Params = {
  api: ApiClient;
  joined: JoinResp | null;
  appSessionToken: string;
  userName: string;
  messages: MessageItem[];
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  pushLog: (s: string) => void;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file read error"));
    reader.readAsDataURL(file);
  });
}

export function useAvatarState({
  api,
  joined,
  appSessionToken,
  userName,
  messages,
  setMessages,
  pushLog,
}: Params) {
  const [avatarPreview, setAvatarPreview] = useState<string>(() => loadCachedAvatar(userName));
  const avatarUploadDataRef = useRef<string>("");
  const avatarPreviewBlobRef = useRef<string>("");
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>({
    kind: "idle",
    text: "未上传，使用默认头像",
  });
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (avatarPreviewBlobRef.current) {
        URL.revokeObjectURL(avatarPreviewBlobRef.current);
        avatarPreviewBlobRef.current = "";
      }
    };
  }, []);

  useEffect(() => {
    if (avatarPreviewBlobRef.current) return;
    const cached = loadCachedAvatar(userName);
    setAvatarPreview(cached);
    setAvatarStatus(
      cached
        ? { kind: "ok", text: "已加载本地头像缓存" }
        : { kind: "idle", text: "未上传，使用默认头像" },
    );
  }, [userName]);

  useEffect(() => {
    if (!joined) {
      setAvatarEditorOpen(false);
    }
  }, [joined]);

  useEffect(() => {
    const name = userName.trim();
    if (!name) return;
    const latestAvatar = [...messages]
      .reverse()
      .find((m) => m.user_name === name && !!m.avatar_url)?.avatar_url;
    if (!latestAvatar) return;
    saveCachedAvatar(name, latestAvatar);
    if (!avatarPreviewBlobRef.current && avatarPreview !== latestAvatar) {
      setAvatarPreview(latestAvatar);
      setAvatarStatus({ kind: "ok", text: "已同步已上传头像" });
    }
  }, [messages, userName, avatarPreview]);

  const syncAvatarFromServer = (name: string, avatarUrl?: string | null) => {
    const next = avatarUrl?.trim() ?? "";
    if (next) {
      if (!avatarPreviewBlobRef.current) {
        setAvatarPreview(next);
      }
      saveCachedAvatar(name, next);
      setAvatarStatus({ kind: "ok", text: "已同步已上传头像" });
    } else {
      if (!avatarPreviewBlobRef.current) {
        setAvatarPreview("");
      }
      clearCachedAvatar(name);
      setAvatarStatus({ kind: "idle", text: "未上传，使用默认头像" });
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.user_name === name ? { ...m, avatar_url: next || null } : m,
      ),
    );
  };

  const resetAvatarTransient = () => {
    avatarUploadDataRef.current = "";
    setAvatarEditorOpen(false);
    if (avatarPreviewBlobRef.current) {
      URL.revokeObjectURL(avatarPreviewBlobRef.current);
      avatarPreviewBlobRef.current = "";
    }
  };

  const openAvatarEditor = () => {
    if (!joined) return;
    setAvatarEditorOpen(true);
  };

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarFileChange = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarPreview(loadCachedAvatar(userName));
      avatarUploadDataRef.current = "";
      setAvatarStatus({ kind: "error", text: "上传失败：仅支持图片，已使用默认头像" });
      pushLog("avatar upload failed: only image files are allowed, using default avatar");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarPreview(loadCachedAvatar(userName));
      avatarUploadDataRef.current = "";
      setAvatarStatus({ kind: "error", text: "上传失败：图片超过 2MB，已使用默认头像" });
      pushLog("avatar upload failed: file must be <= 2MB, using default avatar");
      return;
    }
    if (avatarPreviewBlobRef.current) {
      URL.revokeObjectURL(avatarPreviewBlobRef.current);
      avatarPreviewBlobRef.current = "";
    }
    const objectUrl = URL.createObjectURL(file);
    avatarPreviewBlobRef.current = objectUrl;
    setAvatarPreview(objectUrl);

    void fileToDataUrl(file)
      .then((data) => {
        if (!data.startsWith("data:image/")) {
          setAvatarPreview(loadCachedAvatar(userName));
          avatarUploadDataRef.current = "";
          setAvatarStatus({ kind: "error", text: "上传失败：图片编码异常，已使用默认头像" });
          pushLog("avatar upload failed: invalid data url");
          return;
        }
        avatarUploadDataRef.current = data;
        if (joined && appSessionToken) {
          void api
            .uploadAvatar(data, appSessionToken)
            .then((uploaded) => {
              setAvatarPreview(uploaded.avatar_url);
              saveCachedAvatar(userName.trim(), uploaded.avatar_url);
              avatarUploadDataRef.current = "";
              if (avatarPreviewBlobRef.current) {
                URL.revokeObjectURL(avatarPreviewBlobRef.current);
                avatarPreviewBlobRef.current = "";
              }
              setAvatarStatus({ kind: "ok", text: "头像上传成功" });
              setMessages((prev) =>
                prev.map((m) =>
                  m.user_name === userName.trim() ? { ...m, avatar_url: uploaded.avatar_url } : m,
                ),
              );
              pushLog(`avatar uploaded: ${uploaded.avatar_url}`);
            })
            .catch((e) => {
              setAvatarStatus({ kind: "error", text: "头像上传失败，已使用默认头像" });
              pushLog(`avatar upload failed: ${String(e)}`);
            });
        } else {
          setAvatarStatus({ kind: "ok", text: "头像已选择，加入后自动上传" });
          pushLog("avatar selected");
        }
      })
      .catch(() => {
        setAvatarPreview(loadCachedAvatar(userName));
        avatarUploadDataRef.current = "";
        setAvatarStatus({ kind: "error", text: "上传失败：读取图片失败，已使用默认头像" });
        pushLog("avatar upload failed: file read error");
      });
  };

  return {
    avatarPreview,
    setAvatarPreview,
    avatarStatus,
    setAvatarStatus,
    avatarEditorOpen,
    setAvatarEditorOpen,
    fileInputRef,
    avatarUploadDataRef,
    avatarPreviewBlobRef,
    syncAvatarFromServer,
    resetAvatarTransient,
    openAvatarEditor,
    onPickAvatar,
    onAvatarFileChange,
  };
}

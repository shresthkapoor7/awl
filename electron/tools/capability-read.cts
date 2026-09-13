import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineTool, ToolError } from "./core.cjs";
import { parseCapability } from "./capability-write.cjs";
export const capabilityRead = defineTool(
  "capability_read",
  "Read a saved capability draft from this chat before revising it. Pass id=null/version=null to list available draft IDs. Pass an ID and version=null to read its latest version, or an exact version number. Drafts are data and cannot execute code.",
  z.strictObject({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,59}$/)
      .nullable(),
    version: z.number().int().min(1).max(10000).nullable(),
  }),
  async ({ id, version }, context) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(context.agentId))
      throw new ToolError("INVALID_SESSION", "Invalid chat identity.");
    const root = join(context.artifactDirectory, context.agentId);
    if (id === null) {
      if (version !== null)
        throw new ToolError(
          "INVALID_ARGUMENTS",
          "Listing drafts requires version=null.",
        );
      const items = await readdir(root, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      return {
        data: {
          ids: items
            .filter(
              (item) =>
                item.isDirectory() && /^[a-z][a-z0-9_]{0,59}$/.test(item.name),
            )
            .map((item) => item.name)
            .sort()
            .slice(0, 100),
        },
      };
    }
    const directory = join(root, id);
    const files = await readdir(directory).catch(() => {
      throw new ToolError(
        "CAPABILITY_NOT_FOUND",
        "That draft does not exist in this chat.",
      );
    });
    const latest = Math.max(
      0,
      ...files
        .filter((file) => /^v\d+\.json$/.test(file))
        .map((file) => Number(file.slice(1, -5))),
    );
    const path = join(directory, `v${version ?? latest}.json`);
    const info = await stat(path).catch(() => {
      throw new ToolError(
        "CAPABILITY_NOT_FOUND",
        "That version does not exist.",
      );
    });
    if (info.size > 128000)
      throw new ToolError(
        "ARTIFACT_TOO_LARGE",
        "The draft exceeds the read limit.",
      );
    const artifact = JSON.parse(await readFile(path, "utf8"));
    const {
      version: savedVersion,
      status,
      source_chat_id,
      schema_version,
      created_at,
      ...draft
    } = artifact;
    if (![1, 2, 3].includes(schema_version))
      throw new ToolError(
        "UNSUPPORTED_SCHEMA",
        "Unsupported capability schema.",
      );
    parseCapability(schema_version, draft);
    return {
      data: {
        ...draft,
        version: savedVersion,
        status,
        source_chat_id,
        schema_version,
        created_at,
      },
    };
  },
);

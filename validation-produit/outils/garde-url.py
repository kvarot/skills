"""PreToolUse hook for a simulated user: only the browser tools on the allow-list,
and only the origin of the product under test. Any error refuses (exit 2):
a hook that crashes must never let a call through.

Environment (set by lancer-persona.mjs):
  GARDE_ORIGINE  e.g. http://127.0.0.1:18711   (the only origin allowed)
  GARDE_OUTILS   comma-separated tool names allowed (full mcp__ names)
"""
import json
import os
import sys


def refuse(reason):
    print("REFUSÉ par garde-url : " + reason, file=sys.stderr)
    sys.exit(2)


try:
    data = json.load(sys.stdin)
    tool = data.get("tool_name") or ""
    allowed = {t.strip() for t in os.environ.get("GARDE_OUTILS", "").split(",") if t.strip()}
    origin = os.environ.get("GARDE_ORIGINE", "").rstrip("/")
    if not allowed or not origin:
        refuse("garde non configurée")
    if tool not in allowed:
        refuse("outil non autorisé : " + tool)
    ti = data.get("tool_input") or {}
    url = ti.get("url")
    if url is not None:
        if url != "about:blank" and not (url == origin or url.startswith(origin + "/") or url.startswith(origin + "?") or url.startswith(origin + "#")):
            refuse("seule l'adresse du produit testé est permise")
    for key in ("filePath", "filePaths", "outputDirPath", "sourcePath"):
        v = ti.get(key)
        if v is None:
            continue
        vals = v if isinstance(v, list) else [v]
        for p in vals:
            s = str(p)
            if os.path.isabs(s) or ".." in s.replace("\\", "/").split("/"):
                refuse("chemin de fichier non relatif : " + key)
    sys.exit(0)
except SystemExit:
    raise
except Exception as e:  # fail closed
    refuse("erreur interne " + type(e).__name__)

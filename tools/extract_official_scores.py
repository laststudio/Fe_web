#!/usr/bin/env python3
"""从 e听说官方客户端本地索引中提取「每题官方满分」。

用法：
    python3 extract_official_scores.py <data目录或单个索引文件> [--json out.json]

索引文件位置（手机）：
    /storage/emulated/0/Android/data/com.ets100.secondary/files/Download/ETS_secondary/data/

拉取方式（非 root 即可，该目录在外部存储 Android/data 下）：
    adb pull /storage/emulated/0/Android/data/com.ets100.secondary/files/Download/ETS_secondary/data ./ets_data
    python3 extract_official_scores.py ./ets_data

输出：每个试卷的 paperId、总题数、卷面总分、逐题满分（按 section / order / entityId / fileName）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_index(path: Path) -> dict[str, Any] | None:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
        data = json.loads(raw)
    except Exception:
        return None
    if isinstance(data, dict) and "sectionData" in data:
        return data
    return None


def describe(index: dict[str, Any], source: str) -> dict[str, Any]:
    sections = index.get("sectionData") or []
    questions: list[dict[str, Any]] = []
    per_section: list[dict[str, Any]] = []
    total = 0.0

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        items = [i for i in (sec.get("sectionItemData") or []) if isinstance(i, dict)]
        sec_total = 0.0
        for item in items:
            if item.get("mainItem"):
                continue  # 题组壳，不是真实小题
            try:
                score = float(item.get("maxScore") or 0.0)
            except (TypeError, ValueError):
                score = 0.0
            sec_total += score
            total += score
            questions.append(
                {
                    "section": sec.get("caption"),
                    "category": sec.get("category"),
                    "order": item.get("order"),
                    "entityOrder": item.get("entityOrder"),
                    "entityId": item.get("entityId"),
                    "fileName": item.get("fileName"),
                    "maxScore": score,
                }
            )
        per_section.append(
            {
                "caption": sec.get("caption"),
                "category": sec.get("category"),
                "questions": len([i for i in items if not i.get("mainItem")]),
                "sectionTotal": round(sec_total, 2),
            }
        )

    return {
        "source": source,
        "paperId": index.get("paperId"),
        "newStruct": index.get("newStruct"),
        "fileNameData": index.get("fileNameData"),
        "questionCount": len(questions),
        "paperTotal": round(total, 2),
        "sections": per_section,
        "questions": questions,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="data 目录，或单个索引 JSON 文件")
    ap.add_argument("--json", dest="out", help="把完整结果写入该 JSON 文件")
    args = ap.parse_args()

    root = Path(args.path)
    if not root.exists():
        print(f"路径不存在: {root}", file=sys.stderr)
        return 1

    candidates: list[Path] = []
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if child.is_file():
                candidates.append(child)
    else:
        candidates.append(root)

    results = []
    for f in candidates:
        idx = load_index(f)
        if not idx:
            continue
        results.append(describe(idx, str(f)))

    if not results:
        print("没有找到含 sectionData 的索引文件（该目录里可能只是别的缓存）", file=sys.stderr)
        return 2

    for r in results:
        print("=" * 72)
        print(f"文件        : {Path(r['source']).name}")
        print(f"paperId     : {r['paperId']}")
        print(f"题数 / 总分 : {r['questionCount']} 题 / {r['paperTotal']} 分")
        print("分段：")
        for s in r["sections"]:
            print(f"   {str(s['caption']):<10} {str(s['category']):<24} {s['questions']} 题  小计 {s['sectionTotal']}")
        print("逐题满分：")
        for q in r["questions"]:
            print(
                f"   [{q['section']}] order={q['order']} entityId={q['entityId']} "
                f"fileName={str(q['fileName'])[:12]}… -> {q['maxScore']}"
            )

    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n已写入 {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

// GitHub PR plumbing for the review pane. Pure: no herdr imports, no gh
// calls, so the JSON mapping and every argv can be tested directly.

export const PR_FIELDS = "number,title,body,author,state,isDraft,baseRefName,headRefName,reviewDecision,mergeable,mergeStateStatus,additions,deletions,changedFiles,url,comments,reviews";
export const LIST_FIELDS = "number,title,headRefName,author,updatedAt";

const MAX_BODY = 20000;
const MAX_COMMENTS = 50;

function text(value, cap = MAX_BODY) {
  const body = typeof value === "string" ? value : "";
  return body.length > cap ? body.slice(0, cap) : body;
}

// The exact shape `gh pr view --json ...` returns, as the pane holds it.
export function normalizePr(json) {
  const pr = json ?? {};
  const comments = Array.isArray(pr.comments) ? pr.comments.slice(0, MAX_COMMENTS) : [];
  const reviews = Array.isArray(pr.reviews) ? pr.reviews.slice(0, MAX_COMMENTS) : [];
  return {
    number: pr.number ?? null,
    title: pr.title ?? "",
    body: text(pr.body),
    author: pr.author?.login ?? null,
    state: pr.state ?? "",
    draft: Boolean(pr.isDraft),
    base: pr.baseRefName ?? "",
    head: pr.headRefName ?? "",
    additions: Number(pr.additions) || 0,
    deletions: Number(pr.deletions) || 0,
    changedFiles: Number(pr.changedFiles) || 0,
    url: pr.url ?? null,
    mergeable: pr.mergeable ?? null,
    decision: pr.reviewDecision ?? null,
    comments: comments.map((comment) => ({
      author: comment?.author?.login ?? null,
      body: text(comment?.body),
      at: comment?.createdAt ?? null,
    })),
    reviews: reviews.map((review) => ({
      author: review?.author?.login ?? null,
      state: review?.state ?? "",
      body: text(review?.body),
      at: review?.submittedAt ?? null,
    })),
  };
}

export function normalizeList(json) {
  const list = Array.isArray(json) ? json : [];
  return list.map((pr) => ({
    number: pr?.number ?? null,
    title: pr?.title ?? "",
    head: pr?.headRefName ?? "",
    author: pr?.author?.login ?? null,
    updated: pr?.updatedAt ?? null,
  }));
}

export function viewArgs(n) {
  const args = ["pr", "view"];
  if (n !== undefined && n !== null && n !== "") args.push(String(n));
  args.push("--json", PR_FIELDS);
  return args;
}

export function listArgs(limit = 30) {
  return ["pr", "list", "--json", LIST_FIELDS, "--limit", String(limit)];
}

export function diffArgs(n) {
  return ["pr", "diff", String(n)];
}

const REVIEW_FLAG = { approve: "--approve", "request-changes": "--request-changes", comment: "--comment" };

export function reviewArgs(n, kind, body) {
  const flag = REVIEW_FLAG[kind];
  if (!flag) throw new Error(`Unknown review kind: ${kind}`);
  const message = String(body ?? "");
  if (kind === "request-changes" && !message.trim()) throw new Error("Requesting changes needs a body.");
  return ["pr", "review", String(n), flag, "-b", message];
}

const MERGE_FLAG = { merge: "--merge", squash: "--squash", rebase: "--rebase" };

export function mergeArgs(n, method, deleteBranch) {
  const flag = MERGE_FLAG[method];
  if (!flag) throw new Error(`Unknown merge method: ${method}`);
  const args = ["pr", "merge", String(n), flag];
  if (deleteBranch) args.push("--delete-branch");
  return args;
}

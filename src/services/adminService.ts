import { ApiError } from "./apiClient";
import { entityService } from "./entityService";
import type { AccessRequest } from "./accessRequestService";

const POLICY = "aclpolicy";
const ASSIGNMENT = "useraclpolicy";
const REQUEST = "accessrequest";

// An id that never exists, so the check can never touch a real record.
const PROBE_ID = "zzzadmincheck0";

interface Policy {
  id: string;
  name: string;
}

interface Assignment {
  id: string;
  user_id: string;
  acl_policy_id: string;
  active?: boolean;
}

export type Role = "admin" | "member" | "pending";

export interface Person {
  userId: string;
  role: Role;
  /** What they sent while waiting (null if they never opened the waiting page or nothing could be saved). */
  request: AccessRequest | null;
  /** The assignment rows that make this person a member, so revoking can remove exactly those. */
  memberAssignmentIds: string[];
}

export interface PeopleSnapshot {
  people: Person[];
  memberPolicyId: string;
}

/**
 * Whether this signed-in person can manage who has access. Like the approval check, this asks the backend instead
 * of trusting a label: removing an assignment that does not exist is allowed for an admin (and changes nothing) and
 * refused for everyone else. The page that uses this is only a convenience; the backend enforces the real rule.
 */
export async function checkAdmin(): Promise<boolean> {
  try {
    await entityService.remove(ASSIGNMENT, PROBE_ID);
    return true;
  } catch (e) {
    if (e instanceof ApiError) return false;
    return false;
  }
}

/** Everyone who has an account, grouped by what they can do, with what each one wrote while waiting. */
export async function loadPeople(): Promise<PeopleSnapshot> {
  const [policies, assignments, requests] = await Promise.all([
    entityService.listAll<Policy>(POLICY),
    entityService.listAll<Assignment>(ASSIGNMENT),
    // Records are owner-scoped; `all` is how an admin reads everyone's.
    entityService.listAll<AccessRequest>(REQUEST, { all: true })
  ]);

  const byName = (name: string) => policies.find((p) => p.name === name)?.id;
  const adminId = byName("adminacl");
  // The member policy people are approved into. The older broad "memberacl" still counts as being a member.
  const memberId = byName("cineculemember");
  const legacyMemberId = byName("memberacl");
  if (!adminId || !memberId) throw new Error("The access policies could not be found.");
  const isMemberPolicy = (id: string) => id === memberId || id === legacyMemberId;

  // How much a request tells us; the email counts most, since it is what identifies the person.
  const score = (r: AccessRequest) => Number(Boolean(r.message)) + Number(Boolean(r.resume_name)) + 2 * Number(Boolean(r.email));
  const requestByUser = new Map<string, AccessRequest>();
  for (const r of requests) {
    if (!r.user_id) continue;
    const prev = requestByUser.get(r.user_id);
    // If someone ended up with more than one, keep the one that says the most.
    if (!prev || score(r) > score(prev)) requestByUser.set(r.user_id, r);
  }

  const rowsByUser = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!a.user_id || a.active === false) continue;
    rowsByUser.set(a.user_id, [...(rowsByUser.get(a.user_id) ?? []), a]);
  }

  const people: Person[] = [];
  for (const [userId, rows] of rowsByUser) {
    const isAdmin = rows.some((r) => r.acl_policy_id === adminId);
    const memberRows = rows.filter((r) => isMemberPolicy(r.acl_policy_id));
    people.push({
      userId,
      role: isAdmin ? "admin" : memberRows.length > 0 ? "member" : "pending",
      request: requestByUser.get(userId) ?? null,
      memberAssignmentIds: memberRows.map((r) => r.id)
    });
  }
  return { people, memberPolicyId: memberId };
}

/** Lets a waiting person in. Takes effect the next time they sign in or press "Check now". */
export async function approve(userId: string, memberPolicyId: string): Promise<void> {
  await entityService.create(ASSIGNMENT, { user_id: userId, acl_policy_id: memberPolicyId, name: "Assign cineculemember", active: true });
}

/** Takes a member back to waiting (removes whichever member policy they hold). They keep their account and everything they made. */
export async function revoke(person: Person): Promise<void> {
  for (const id of person.memberAssignmentIds) await entityService.remove(ASSIGNMENT, id);
}

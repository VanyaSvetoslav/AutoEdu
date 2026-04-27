import { request } from 'undici';
import { getMosregCredentials } from './db.js';

const BASE_URL = 'https://authedu.mosreg.ru';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export type HomeworkMaterialUrl = {
  url: string;
  type: string;
};

export type HomeworkMaterial = {
  uuid: string | null;
  type: string;
  type_name: string | null;
  title: string | null;
  description: string | null;
  urls: HomeworkMaterialUrl[];
  action_name: string | null;
};

export type HomeworkEntry = {
  type: string;
  description: string | null;
  homework: string | null;
  materials: HomeworkMaterial[];
  attachments: unknown[];
  subject_id: number;
  group_id: number;
  date: string;
  date_assigned_on: string | null;
  subject_name: string;
  lesson_date_time: string | null;
  is_done: boolean;
  has_teacher_answer: boolean;
  homework_id: number;
  homework_entry_id: number;
};

export type HomeworksResponse = {
  payload: HomeworkEntry[];
};

export type Dynamic = 'UP' | 'DOWN' | 'STABLE' | string;

export type SubjectMark = {
  id: number;
  value: string;
  values: unknown;
  comment: string | null;
  weight: number;
  control_form_name: string | null;
  date: string;
  is_point: boolean;
  is_exam: boolean;
};

export type SubjectMarkPeriod = {
  start: string;
  end: string;
  title: string;
  dynamic: Dynamic;
  value: string;
  marks: SubjectMark[];
};

export type SubjectMarks = {
  subject_id: number;
  subject_name: string;
  average: string;
  average_by_all: string | null;
  dynamic: Dynamic;
  year_mark: string | null;
  periods: SubjectMarkPeriod[];
};

export type SubjectMarksResponse = {
  payload: SubjectMarks[];
};

export type ScheduleHomework = {
  presence_status_id: number;
  total_count: number;
  execute_count: number;
  descriptions: string[];
  materials: unknown;
};

export type ScheduleEntry = {
  id: number;
  source: string;
  start_at: string;
  finish_at: string;
  cancelled: boolean;
  replaced: boolean;
  lesson_type: string | null;
  room_name: string | null;
  room_number: string | null;
  subject_id: number | null;
  subject_name: string | null;
  homework: ScheduleHomework | null;
  marks: unknown;
  is_missed_lesson: boolean | null;
};

export type ScheduleResponse = {
  total_count: number;
  response: ScheduleEntry[];
};

export class MosregApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`mosreg API error ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

export class MosregNotConfiguredError extends Error {
  constructor() {
    super(
      'Mosreg credentials are not configured. Use /settoken, /setcookie and /setstudent first.',
    );
  }
}

export class MosregPersonNotConfiguredError extends Error {
  constructor() {
    super('Mosreg person_id (UUID) is not configured. Admin must run /setperson <UUID> first.');
  }
}

export async function fetchHomeworks(from: string, to: string): Promise<HomeworkEntry[]> {
  const creds = getMosregCredentials();
  if (!creds.token || !creds.studentId) {
    throw new MosregNotConfiguredError();
  }

  const profileId = creds.profileId ?? creds.studentId;
  const url = `${BASE_URL}/api/family/web/v1/homeworks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
    to,
  )}&student_id=${encodeURIComponent(creds.studentId)}`;

  // Mosreg accepts the request with just Authorization + X-mes-subsystem
  // (verified via Bruno against /api/family/web/v1/homeworks). We send the
  // other headers to mimic the browser, but Cookie is now optional — when the
  // user only provides /settoken (no /setcookie), we skip the Cookie header
  // rather than send an empty one (which mosreg has been observed to 401 on).
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: creds.token.startsWith('Bearer ') ? creds.token : `Bearer ${creds.token}`,
    'Profile-Id': profileId,
    'Profile-Type': 'student',
    'User-Agent': USER_AGENT,
    'X-mes-subsystem': 'familyweb',
  };
  if (creds.cookie && creds.cookie.trim() !== '') {
    headers.Cookie = creds.cookie;
  }

  const res = await request(url, {
    method: 'GET',
    headers,
  });

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new MosregApiError(res.statusCode, text);
  }

  let parsed: HomeworksResponse;
  try {
    parsed = JSON.parse(text) as HomeworksResponse;
  } catch {
    throw new MosregApiError(res.statusCode, `Invalid JSON: ${text.slice(0, 200)}`);
  }
  return parsed.payload ?? [];
}

export async function fetchSubjectMarks(): Promise<SubjectMarks[]> {
  const creds = getMosregCredentials();
  if (!creds.token || !creds.studentId) {
    throw new MosregNotConfiguredError();
  }

  const profileId = creds.profileId ?? creds.studentId;
  const url = `${BASE_URL}/api/family/web/v1/subject_marks?student_id=${encodeURIComponent(
    creds.studentId,
  )}`;

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: creds.token.startsWith('Bearer ') ? creds.token : `Bearer ${creds.token}`,
    'Profile-Id': profileId,
    'Profile-Type': 'student',
    'User-Agent': USER_AGENT,
    'X-mes-subsystem': 'familyweb',
  };
  if (creds.cookie && creds.cookie.trim() !== '') {
    headers.Cookie = creds.cookie;
  }

  const res = await request(url, { method: 'GET', headers });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new MosregApiError(res.statusCode, text);
  }
  let parsed: SubjectMarksResponse;
  try {
    parsed = JSON.parse(text) as SubjectMarksResponse;
  } catch {
    throw new MosregApiError(res.statusCode, `Invalid JSON: ${text.slice(0, 200)}`);
  }
  return parsed.payload ?? [];
}

export async function fetchSchedule(from: string, to: string): Promise<ScheduleEntry[]> {
  const creds = getMosregCredentials();
  if (!creds.token || !creds.studentId) {
    throw new MosregNotConfiguredError();
  }
  if (!creds.personId) {
    throw new MosregPersonNotConfiguredError();
  }

  const profileId = creds.profileId ?? creds.studentId;
  const sources = 'PLAN,AE,EC,EVENTS,AFISHA,ORGANIZER,OLYMPIAD,PROF';
  const url =
    `${BASE_URL}/api/eventcalendar/v1/api/events` +
    `?person_ids=${encodeURIComponent(creds.personId)}` +
    `&begin_date=${encodeURIComponent(from)}` +
    `&end_date=${encodeURIComponent(to)}` +
    `&source_types=${encodeURIComponent(sources)}` +
    `&expand=homework`;

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: creds.token.startsWith('Bearer ') ? creds.token : `Bearer ${creds.token}`,
    'Profile-Id': profileId,
    'Profile-Type': 'student',
    'User-Agent': USER_AGENT,
    'X-mes-subsystem': 'familyweb',
  };
  if (creds.cookie && creds.cookie.trim() !== '') {
    headers.Cookie = creds.cookie;
  }

  const res = await request(url, { method: 'GET', headers });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new MosregApiError(res.statusCode, text);
  }
  let parsed: ScheduleResponse;
  try {
    parsed = JSON.parse(text) as ScheduleResponse;
  } catch {
    throw new MosregApiError(res.statusCode, `Invalid JSON: ${text.slice(0, 200)}`);
  }
  return parsed.response ?? [];
}

export type MosregDebugResult = {
  url: string;
  sentAuthLen: number;
  sentCookie: number | null;
  status: number;
  bodyPreview: string;
};

export async function mosregDebugCall(from: string, to: string): Promise<MosregDebugResult> {
  const creds = getMosregCredentials();
  if (!creds.token || !creds.studentId) {
    throw new MosregNotConfiguredError();
  }
  const profileId = creds.profileId ?? creds.studentId;
  const url = `${BASE_URL}/api/family/web/v1/homeworks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
    to,
  )}&student_id=${encodeURIComponent(creds.studentId)}`;
  const auth = creds.token.startsWith('Bearer ') ? creds.token : `Bearer ${creds.token}`;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: auth,
    'Profile-Id': profileId,
    'Profile-Type': 'student',
    'User-Agent': USER_AGENT,
    'X-mes-subsystem': 'familyweb',
  };
  const cookieLen =
    creds.cookie && creds.cookie.trim() !== '' ? Buffer.byteLength(creds.cookie, 'utf8') : null;
  if (cookieLen !== null) {
    headers.Cookie = creds.cookie!;
  }
  const res = await request(url, { method: 'GET', headers });
  const body = await res.body.text();
  return {
    url,
    sentAuthLen: Buffer.byteLength(auth, 'utf8'),
    sentCookie: cookieLen,
    status: res.statusCode,
    bodyPreview: body.slice(0, 400),
  };
}

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

export async function fetchHomeworks(from: string, to: string): Promise<HomeworkEntry[]> {
  const creds = getMosregCredentials();
  if (!creds.token || !creds.cookie || !creds.studentId) {
    throw new MosregNotConfiguredError();
  }

  const profileId = creds.profileId ?? creds.studentId;
  const url = `${BASE_URL}/api/family/web/v1/homeworks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
    to,
  )}&student_id=${encodeURIComponent(creds.studentId)}`;

  const res = await request(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      Authorization: creds.token.startsWith('Bearer ') ? creds.token : `Bearer ${creds.token}`,
      Cookie: creds.cookie,
      'Content-Type': 'application/json;charset=UTF-8',
      'Profile-Id': profileId,
      'Profile-Type': 'student',
      Referer: `${BASE_URL}/diary/homeworks/homeworks/`,
      'User-Agent': USER_AGENT,
      'X-mes-subsystem': 'familyweb',
    },
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

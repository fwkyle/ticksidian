// TickTick Core Data 스키마 검증 기대값과 읽기 전용 SQL 쿼리.
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).
// SQL은 SELECT와 읽기 전용 PRAGMA만 둔다(설계 §4 안전 경계).

export const REQUIRED_SCHEMA = {
  ZTTTASK: [
    "Z_PK",
    "ZALLDAY",
    "ZDELETIONSTATUS",
    "ZPRIORITY",
    "ZSORTORDER",
    "ZSTATUS",
    "ZPROJECT",
    "ZCREATIONDATE",
    "ZENDDATE",
    "ZLASTMODIFIEDDATE",
    "ZSTARTDATE",
    "ZCONTENT",
    "ZDEZCRIPTION",
    "ZENTITYID",
    "ZETAG",
    "ZKIND",
    "ZNOTIONBLOCKSTRING",
    "ZPROJECTID",
    "ZREPEATRULE",
    "ZSTRINGOFTAGS",
    "ZTIMEZONENAME",
    "ZTITLE",
  ],
  ZTTPROJECT: [
    "Z_PK",
    "ZISINBOX",
    "ZSORTORDER",
    "ZENTITYID",
    "ZKIND",
    "ZNAME",
  ],
  ZTTCHECKLISTITEM: [
    "ZALLDAY",
    "ZSORTORDER",
    "ZSTATUS",
    "ZTASK",
    "ZCOMPLETIONDATE",
    "ZSTARTDATE",
    "ZENTITYID",
    "ZTITLE",
  ],
  ZTTREMINDER: ["ZTASK", "ZENTITYID", "ZRULE"],
  ZTTATTACHMENT: [
    "ZFILESIZE",
    "ZFILETYPE",
    "ZSTATUS",
    "ZTASK",
    "ZCREATIONDATE",
    "ZLASTMODIFIEDDATE",
    "ZENTITYID",
    "ZFILENAME",
  ],
};

export const ACTIVE_TASK_QUERY = `
  SELECT
    t.Z_PK AS local_pk,
    t.ZALLDAY AS all_day,
    t.ZPRIORITY AS priority,
    CAST(t.ZSORTORDER AS TEXT) AS sort_order,
    t.ZCREATIONDATE AS creation_date,
    t.ZENDDATE AS end_date,
    t.ZLASTMODIFIEDDATE AS modified_date,
    t.ZSTARTDATE AS start_date,
    t.ZCONTENT AS content,
    t.ZDEZCRIPTION AS description,
    t.ZENTITYID AS source_id,
    t.ZETAG AS etag,
    t.ZKIND AS kind,
    t.ZNOTIONBLOCKSTRING AS rich_metadata,
    t.ZPROJECTID AS stored_project_id,
    t.ZREPEATRULE AS repeat_rule,
    t.ZSTRINGOFTAGS AS tags,
    t.ZTIMEZONENAME AS timezone,
    t.ZTITLE AS title,
    p.ZENTITYID AS project_id,
    p.ZISINBOX AS project_is_inbox,
    p.ZKIND AS project_kind,
    p.ZNAME AS project_name,
    CAST(p.ZSORTORDER AS TEXT) AS project_sort_order
  FROM ZTTTASK t
  LEFT JOIN ZTTPROJECT p ON p.Z_PK = t.ZPROJECT
  WHERE t.ZSTATUS = 0 AND t.ZDELETIONSTATUS = 0
  ORDER BY
    CASE WHEN p.ZISINBOX = 1 THEN 0 ELSE 1 END,
    p.ZSORTORDER,
    t.ZSORTORDER,
    t.ZCREATIONDATE
`;

export const CHECKLIST_QUERY = `
  SELECT
    t.ZENTITYID AS task_id,
    i.ZALLDAY AS all_day,
    CAST(i.ZSORTORDER AS TEXT) AS sort_order,
    i.ZSTATUS AS status,
    i.ZCOMPLETIONDATE AS completion_date,
    i.ZSTARTDATE AS start_date,
    i.ZENTITYID AS source_id,
    i.ZTITLE AS title
  FROM ZTTCHECKLISTITEM i
  JOIN ZTTTASK t ON t.Z_PK = i.ZTASK
  WHERE t.ZSTATUS = 0 AND t.ZDELETIONSTATUS = 0
  ORDER BY i.ZSORTORDER, i.Z_PK
`;

export const REMINDER_QUERY = `
  SELECT
    t.ZENTITYID AS task_id,
    r.ZENTITYID AS source_id,
    r.ZRULE AS rule
  FROM ZTTREMINDER r
  JOIN ZTTTASK t ON t.Z_PK = r.ZTASK
  WHERE t.ZSTATUS = 0 AND t.ZDELETIONSTATUS = 0
  ORDER BY r.Z_PK
`;

export const ATTACHMENT_QUERY = `
  SELECT
    t.ZENTITYID AS task_id,
    a.ZFILESIZE AS file_size,
    a.ZFILETYPE AS file_type,
    a.ZSTATUS AS status,
    a.ZCREATIONDATE AS creation_date,
    a.ZLASTMODIFIEDDATE AS modified_date,
    a.ZENTITYID AS source_id,
    a.ZFILENAME AS file_name
  FROM ZTTATTACHMENT a
  JOIN ZTTTASK t ON t.Z_PK = a.ZTASK
  WHERE t.ZSTATUS = 0 AND t.ZDELETIONSTATUS = 0
  ORDER BY a.Z_PK
`;

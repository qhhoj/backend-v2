SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (7001,'grp7','Group 7');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (7001,'type7','Type 7');
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (7001,'p7','P7',1,65536,1000,7001,'F','O','A','2022-12-01 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (7001,7001,7001);
INSERT INTO judge_judge (id, name, created, auth_key) VALUES (7001,'j7','2021-01-01 00:00:00','k7');
INSERT INTO judge_submission (id, date, time, memory, points, status, result, error, current_testcase, batch, case_points, case_total, is_pretested, judged_on_id, language_id, problem_id, user_id, contest_object_id, judged_date, locked_after, rejudged_date) VALUES
 (7001,'2023-03-01 10:00:00',0.25,2048,400,'D','WA',NULL,3,0,1,2.5,0,7001,4,7001,1,NULL,'2023-03-01 10:00:03',NULL,NULL),
 (7002,'2023-03-01 10:05:00',NULL,NULL,NULL,'G',NULL,NULL,1,0,0,0,0,7001,4,7001,2,NULL,NULL,NULL,NULL),
 (7003,'2023-03-01 10:06:00',NULL,NULL,NULL,'D','AC',NULL,0,0,1,1,0,NULL,4,7999,1,NULL,NULL,NULL,NULL),
 (7004,'2023-03-01 10:07:00',NULL,NULL,0,'D','',NULL,0,0,0,0,0,7001,4,7001,1,NULL,NULL,NULL,NULL);
INSERT INTO judge_submission (id, date, points, status, result, case_points, case_total, language_id, problem_id, user_id) VALUES
 (7010,'2023-03-02 10:00:00',100,'D','AC',2,2,4,4005,1),
 (7011,'2023-03-02 10:01:00',50,'D','WA',1,2,4,4005,1),
 (7012,'2023-03-02 10:02:00',9000,'D','AC',2,2,4,4006,1),
 (7013,'2023-03-02 10:03:00',NULL,'G',NULL,0,0,4,4005,2);
INSERT INTO judge_submissiontestcase (id, `case`, status, time, memory, points, total, batch, feedback, extended_feedback, output, submission_id) VALUES
 (7003,2,'WA',0.2,1024,0,1.5,NULL,'wrong','','',7001),
 (7001,1,'AC',0.1,1024,1,1,NULL,'','',REPEAT('é',300),7001),
 (7002,3,'ZZ',0,0,0,0,NULL,'','','',7001),
 (7005,4,'RJ',0,0,0,0,NULL,'','','',7001),
 (7004,1,'AC',0.1,1024,1,1,NULL,'','','',7003);
INSERT INTO judge_submissionsource (id, source, submission_id) VALUES (7001,'int main() {}',7001),(7002,'/submission_file/p7/2/a.sb3',7002),(7003,'x',7003);
SET FOREIGN_KEY_CHECKS=1;

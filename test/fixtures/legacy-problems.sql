SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (4001,'grp4','Group 4');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (4001,'type4','Type 4');
INSERT INTO judge_problem (id, code, name, description, time_limit, memory_limit, points, partial, is_public, is_manually_managed, date, og_image, summary, user_count, ac_rate, is_organization_private, group_id, license_id, is_full_markup, pdf_url, source, suggester_id, submission_source_visibility_mode, testcase_visibility_mode, allow_view_feedback, testcase_result_visibility_mode, problem_material, mirror_of_id, mirror_root_id) VALUES
 (4001,'sum4','Sum','Tính $a+b$ **nhanh**',1,262144,1000,1,1,0,'2021-01-01 00:00:00','','',7,0.5,0,4001,NULL,0,'','VOI',1,'F','O',0,'A','problem_materials/sum4.pdf',4999,NULL),
 (4002,'nodata4','No data','',2,65536,1200,0,0,0,'2021-01-02 00:00:00','','',0,0,0,4001,NULL,0,'https://cdn.example/p.pdf','',NULL,'A','C',1,'B',NULL,NULL,4003),
 (4003,'lost4','Lost','',1,65536,1000,0,0,0,'2021-01-03 00:00:00','','',0,0,0,4999,NULL,0,'','',NULL,'F','O',0,'A',NULL,NULL,NULL);
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (4001,4001,4001),(4002,4002,4001),(4003,4003,4001);
INSERT INTO judge_problem_authors (id, problem_id, profile_id) VALUES (4001,4001,1);
INSERT INTO judge_problem_curators (id, problem_id, profile_id) VALUES (4001,4001,2);
INSERT INTO judge_problem_organizations (id, problem_id, organization_id) VALUES (4001,4001,1);
INSERT INTO judge_problem_allowed_languages (id, problem_id, language_id) VALUES (4001,4001,4),(4002,4001,5);
INSERT INTO judge_languagelimit (id, time_limit, memory_limit, language_id, problem_id) VALUES (4001,2,524288,9,4001);
INSERT INTO judge_problemtranslation (id, language, name, description, problem_id) VALUES (4001,'en','Sum','Add *two*',4001),(4002,'fr','Somme','x',4001);
INSERT INTO judge_solution (id, is_public, publish_on, content, problem_id) VALUES (4001,1,'2021-02-01 00:00:00','Use **long long**',4001);
INSERT INTO judge_solution_authors (id, solution_id, profile_id) VALUES (4001,4001,1);
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (4004,'sorted4','Sorted',1,65536,1000,4001,'F','O','A','2021-01-04 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (4004,4004,4001);
INSERT INTO judge_problemdata (id, zipfile, generator, output_prefix, output_limit, feedback, checker, checker_args, problem_id, custom_checker, custom_grader, custom_header, grader, grader_args, nobigmath, `unicode`) VALUES
 (4001,'sum4/tests.zip','',NULL,NULL,'','floats','{"precision": 6}',4001,'sum4/check.cpp','','','standard','',0,1),
 (4002,'old4/tests.zip','',NULL,NULL,'','sorted','',4004,'','','','standard','',0,0);
INSERT INTO judge_problemtestcase (id, `order`, type, input_file, output_file, generator_args, points, is_pretest, output_prefix, output_limit, checker, checker_args, dataset_id) VALUES
 (4001,2,'C','2.in','2.out','',60,0,NULL,NULL,'','',4001),
 (4002,1,'C','1.in','1.out','',40,1,NULL,NULL,'identical','',4001),
 (4003,3,'C','3.in','3.out','',0,0,NULL,NULL,'rstripped','',4001);
SET FOREIGN_KEY_CHECKS=1;
SET FOREIGN_KEY_CHECKS=0;
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES
 (4005,'low4','Low',1,65536,100,4001,'F','O','A','2021-01-05 00:00:00'),
 (4006,'high4','High',1,65536,9000,4001,'F','O','A','2021-01-06 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (4005,4005,4001),(4006,4006,4001);
UPDATE judge_problem SET pdf_url='statements/low.pdf' WHERE id=4005;
UPDATE judge_problem SET pdf_url='/static/high.pdf' WHERE id=4006;
SET FOREIGN_KEY_CHECKS=1;

/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;
DROP TABLE IF EXISTS `auth_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_group` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_group` WRITE;
/*!40000 ALTER TABLE `auth_group` DISABLE KEYS */;
INSERT INTO `auth_group` VALUES
(2,'Org Admin'),
(1,'Staff');
/*!40000 ALTER TABLE `auth_group` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `auth_group_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_group_permissions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `group_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_group_permissions_group_id_permission_id_0cd325b0_uniq` (`group_id`,`permission_id`),
  KEY `auth_group_permissio_permission_id_84c5c92e_fk_auth_perm` (`permission_id`),
  CONSTRAINT `auth_group_permissio_permission_id_84c5c92e_fk_auth_perm` FOREIGN KEY (`permission_id`) REFERENCES `auth_permission` (`id`),
  CONSTRAINT `auth_group_permissions_group_id_b120cbf9_fk_auth_group_id` FOREIGN KEY (`group_id`) REFERENCES `auth_group` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_group_permissions` WRITE;
/*!40000 ALTER TABLE `auth_group_permissions` DISABLE KEYS */;
INSERT INTO `auth_group_permissions` VALUES
(1,1,101),
(2,2,99);
/*!40000 ALTER TABLE `auth_group_permissions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `auth_permission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_permission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `content_type_id` int(11) NOT NULL,
  `codename` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_permission_content_type_id_codename_01ab375a_uniq` (`content_type_id`,`codename`),
  CONSTRAINT `auth_permission_content_type_id_2f476e4b_fk_django_co` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=328 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_permission` WRITE;
/*!40000 ALTER TABLE `auth_permission` DISABLE KEYS */;
INSERT INTO `auth_permission` VALUES
(1,'Can add log entry',1,'add_logentry'),
(2,'Can change log entry',1,'change_logentry'),
(3,'Can delete log entry',1,'delete_logentry'),
(4,'Can view log entry',1,'view_logentry'),
(5,'Can add blog post',2,'add_blogpost'),
(6,'Can change blog post',2,'change_blogpost'),
(7,'Can delete blog post',2,'delete_blogpost'),
(8,'Can view blog post',2,'view_blogpost'),
(9,'Edit all posts',2,'edit_all_post'),
(10,'Edit organization posts',2,'edit_organization_post'),
(11,'Mark post as global',2,'mark_global_post'),
(12,'Pin post',2,'pin_post'),
(13,'Can add comment',3,'add_comment'),
(14,'Can change comment',3,'change_comment'),
(15,'Can delete comment',3,'delete_comment'),
(16,'Can view comment',3,'view_comment'),
(17,'View all comments by a user',3,'view_all_user_comment'),
(18,'Can add comment lock',4,'add_commentlock'),
(19,'Can change comment lock',4,'change_commentlock'),
(20,'Can delete comment lock',4,'delete_commentlock'),
(21,'Can view comment lock',4,'view_commentlock'),
(22,'Override comment lock',4,'override_comment_lock'),
(23,'Can add comment vote',5,'add_commentvote'),
(24,'Can change comment vote',5,'change_commentvote'),
(25,'Can delete comment vote',5,'delete_commentvote'),
(26,'Can view comment vote',5,'view_commentvote'),
(27,'Can add contest',6,'add_contest'),
(28,'Can change contest',6,'change_contest'),
(29,'Can delete contest',6,'delete_contest'),
(30,'Can view contest',6,'view_contest'),
(31,'See private contests',6,'see_private_contest'),
(32,'Edit own contests',6,'edit_own_contest'),
(33,'Edit all contests',6,'edit_all_contest'),
(34,'Clone contest',6,'clone_contest'),
(35,'MOSS contest',6,'moss_contest'),
(36,'Rate contests',6,'contest_rating'),
(37,'Contest access codes',6,'contest_access_code'),
(38,'Create private contests',6,'create_private_contest'),
(39,'Change contest visibility',6,'change_contest_visibility'),
(40,'Edit contest problem label script',6,'contest_problem_label'),
(41,'Change lock status of contest',6,'lock_contest'),
(42,'Can add contest participation',7,'add_contestparticipation'),
(43,'Can change contest participation',7,'change_contestparticipation'),
(44,'Can delete contest participation',7,'delete_contestparticipation'),
(45,'Can view contest participation',7,'view_contestparticipation'),
(46,'Can add contest problem',8,'add_contestproblem'),
(47,'Can change contest problem',8,'change_contestproblem'),
(48,'Can delete contest problem',8,'delete_contestproblem'),
(49,'Can view contest problem',8,'view_contestproblem'),
(50,'Can add contest submission',9,'add_contestsubmission'),
(51,'Can change contest submission',9,'change_contestsubmission'),
(52,'Can delete contest submission',9,'delete_contestsubmission'),
(53,'Can view contest submission',9,'view_contestsubmission'),
(54,'Can add contest tag',10,'add_contesttag'),
(55,'Can change contest tag',10,'change_contesttag'),
(56,'Can delete contest tag',10,'delete_contesttag'),
(57,'Can view contest tag',10,'view_contesttag'),
(58,'Can add judge',11,'add_judge'),
(59,'Can change judge',11,'change_judge'),
(60,'Can delete judge',11,'delete_judge'),
(61,'Can view judge',11,'view_judge'),
(62,'Can add language',12,'add_language'),
(63,'Can change language',12,'change_language'),
(64,'Can delete language',12,'delete_language'),
(65,'Can view language',12,'view_language'),
(66,'Can add language-specific resource limit',13,'add_languagelimit'),
(67,'Can change language-specific resource limit',13,'change_languagelimit'),
(68,'Can delete language-specific resource limit',13,'delete_languagelimit'),
(69,'Can view language-specific resource limit',13,'view_languagelimit'),
(70,'Can add license',14,'add_license'),
(71,'Can change license',14,'change_license'),
(72,'Can delete license',14,'delete_license'),
(73,'Can view license',14,'view_license'),
(74,'Can add configuration item',15,'add_miscconfig'),
(75,'Can change configuration item',15,'change_miscconfig'),
(76,'Can delete configuration item',15,'delete_miscconfig'),
(77,'Can view configuration item',15,'view_miscconfig'),
(78,'Can add navigation item',16,'add_navigationbar'),
(79,'Can change navigation item',16,'change_navigationbar'),
(80,'Can delete navigation item',16,'delete_navigationbar'),
(81,'Can view navigation item',16,'view_navigationbar'),
(82,'Can add organization',17,'add_organization'),
(83,'Can change organization',17,'change_organization'),
(84,'Can delete organization',17,'delete_organization'),
(85,'Can view organization',17,'view_organization'),
(86,'Administer organizations',17,'organization_admin'),
(87,'Edit all organizations',17,'edit_all_organization'),
(88,'Change is_open field',17,'change_open_organization'),
(89,'Create organization without limit',17,'spam_organization'),
(90,'Can add organization join request',18,'add_organizationrequest'),
(91,'Can change organization join request',18,'change_organizationrequest'),
(92,'Can delete organization join request',18,'delete_organizationrequest'),
(93,'Can view organization join request',18,'view_organizationrequest'),
(94,'Can add problem',19,'add_problem'),
(95,'Can change problem',19,'change_problem'),
(96,'Can delete problem',19,'delete_problem'),
(97,'Can view problem',19,'view_problem'),
(98,'See hidden problems',19,'see_private_problem'),
(99,'Edit own problems',19,'edit_own_problem'),
(100,'Create organization problem',19,'create_organization_problem'),
(101,'Edit all problems',19,'edit_all_problem'),
(102,'Edit all public problems',19,'edit_public_problem'),
(103,'Suggest new problem',19,'suggest_new_problem'),
(104,'Edit problems with full markup',19,'problem_full_markup'),
(105,'Clone problem',19,'clone_problem'),
(106,'Upload file-type statement',19,'upload_file_statement'),
(107,'Upload problem materials',19,'upload_problem_material'),
(108,'Change is_public field',19,'change_public_visibility'),
(109,'Change is_manually_managed field',19,'change_manually_managed'),
(110,'See organization-private problems',19,'see_organization_problem'),
(111,'Import Codeforces Polygon package',19,'import_polygon_package'),
(112,'Can add problem clarification',20,'add_problemclarification'),
(113,'Can change problem clarification',20,'change_problemclarification'),
(114,'Can delete problem clarification',20,'delete_problemclarification'),
(115,'Can view problem clarification',20,'view_problemclarification'),
(116,'Can add problem data',21,'add_problemdata'),
(117,'Can change problem data',21,'change_problemdata'),
(118,'Can delete problem data',21,'delete_problemdata'),
(119,'Can view problem data',21,'view_problemdata'),
(120,'Can add problem group',22,'add_problemgroup'),
(121,'Can change problem group',22,'change_problemgroup'),
(122,'Can delete problem group',22,'delete_problemgroup'),
(123,'Can view problem group',22,'view_problemgroup'),
(124,'Can add problem test case',23,'add_problemtestcase'),
(125,'Can change problem test case',23,'change_problemtestcase'),
(126,'Can delete problem test case',23,'delete_problemtestcase'),
(127,'Can view problem test case',23,'view_problemtestcase'),
(128,'Can add problem translation',24,'add_problemtranslation'),
(129,'Can change problem translation',24,'change_problemtranslation'),
(130,'Can delete problem translation',24,'delete_problemtranslation'),
(131,'Can view problem translation',24,'view_problemtranslation'),
(132,'Can add problem type',25,'add_problemtype'),
(133,'Can change problem type',25,'change_problemtype'),
(134,'Can delete problem type',25,'delete_problemtype'),
(135,'Can view problem type',25,'view_problemtype'),
(136,'Can add user profile',26,'add_profile'),
(137,'Can change user profile',26,'change_profile'),
(138,'Can delete user profile',26,'delete_profile'),
(139,'Can view user profile',26,'view_profile'),
(140,'Shows in-progress development stuff',26,'test_site'),
(141,'Edit TOTP settings',26,'totp'),
(142,'Can upload image directly to server via martor',26,'can_upload_image'),
(143,'Can set high problem timelimit',26,'high_problem_timelimit'),
(144,'Can set long contest duration',26,'long_contest_duration'),
(145,'Can create unlimitted number of testcases for a problem',26,'create_mass_testcases'),
(146,'Ban users',26,'ban_user'),
(147,'Can add contest rating',27,'add_rating'),
(148,'Can change contest rating',27,'change_rating'),
(149,'Can delete contest rating',27,'delete_rating'),
(150,'Can view contest rating',27,'view_rating'),
(151,'Can add runtime version',28,'add_runtimeversion'),
(152,'Can change runtime version',28,'change_runtimeversion'),
(153,'Can delete runtime version',28,'delete_runtimeversion'),
(154,'Can view runtime version',28,'view_runtimeversion'),
(155,'Can add solution',29,'add_solution'),
(156,'Can change solution',29,'change_solution'),
(157,'Can delete solution',29,'delete_solution'),
(158,'Can view solution',29,'view_solution'),
(159,'See hidden solutions',29,'see_private_solution'),
(160,'Can add submission',30,'add_submission'),
(161,'Can change submission',30,'change_submission'),
(162,'Can delete submission',30,'delete_submission'),
(163,'Can view submission',30,'view_submission'),
(164,'Abort any submission',30,'abort_any_submission'),
(165,'Rejudge the submission',30,'rejudge_submission'),
(166,'Reject the submisison',30,'reject_submission'),
(167,'Rejudge a lot of submissions',30,'rejudge_submission_lot'),
(168,'Submit without limit',30,'spam_submission'),
(169,'View all submission',30,'view_all_submission'),
(170,'Resubmit others\' submission',30,'resubmit_other'),
(171,'Change lock status of submission',30,'lock_submission'),
(172,'Can add submission test case',31,'add_submissiontestcase'),
(173,'Can change submission test case',31,'change_submissiontestcase'),
(174,'Can delete submission test case',31,'delete_submissiontestcase'),
(175,'Can view submission test case',31,'view_submissiontestcase'),
(176,'Can add ticket',32,'add_ticket'),
(177,'Can change ticket',32,'change_ticket'),
(178,'Can delete ticket',32,'delete_ticket'),
(179,'Can view ticket',32,'view_ticket'),
(180,'Can add ticket message',33,'add_ticketmessage'),
(181,'Can change ticket message',33,'change_ticketmessage'),
(182,'Can delete ticket message',33,'delete_ticketmessage'),
(183,'Can view ticket message',33,'view_ticketmessage'),
(184,'Can add submission source',34,'add_submissionsource'),
(185,'Can change submission source',34,'change_submissionsource'),
(186,'Can delete submission source',34,'delete_submissionsource'),
(187,'Can view submission source',34,'view_submissionsource'),
(188,'Can add contest moss result',35,'add_contestmoss'),
(189,'Can change contest moss result',35,'change_contestmoss'),
(190,'Can delete contest moss result',35,'delete_contestmoss'),
(191,'Can view contest moss result',35,'view_contestmoss'),
(192,'Can add WebAuthn credential',36,'add_webauthncredential'),
(193,'Can change WebAuthn credential',36,'change_webauthncredential'),
(194,'Can delete WebAuthn credential',36,'delete_webauthncredential'),
(195,'Can view WebAuthn credential',36,'view_webauthncredential'),
(196,'Can add general issue',37,'add_generalissue'),
(197,'Can change general issue',37,'change_generalissue'),
(198,'Can delete general issue',37,'delete_generalissue'),
(199,'Can view general issue',37,'view_generalissue'),
(200,'Can add tag',38,'add_tag'),
(201,'Can change tag',38,'change_tag'),
(202,'Can delete tag',38,'delete_tag'),
(203,'Can view tag',38,'view_tag'),
(204,'Can add tag data',39,'add_tagdata'),
(205,'Can change tag data',39,'change_tagdata'),
(206,'Can delete tag data',39,'delete_tagdata'),
(207,'Can view tag data',39,'view_tagdata'),
(208,'Can add tag group',40,'add_taggroup'),
(209,'Can change tag group',40,'change_taggroup'),
(210,'Can delete tag group',40,'delete_taggroup'),
(211,'Can view tag group',40,'view_taggroup'),
(212,'Can add tag problem',41,'add_tagproblem'),
(213,'Can change tag problem',41,'change_tagproblem'),
(214,'Can delete tag problem',41,'delete_tagproblem'),
(215,'Can view tag problem',41,'view_tagproblem'),
(216,'Can add contest announcement',42,'add_contestannouncement'),
(217,'Can change contest announcement',42,'change_contestannouncement'),
(218,'Can delete contest announcement',42,'delete_contestannouncement'),
(219,'Can view contest announcement',42,'view_contestannouncement'),
(220,'Can add badge',43,'add_badge'),
(221,'Can change badge',43,'change_badge'),
(222,'Can delete badge',43,'delete_badge'),
(223,'Can view badge',43,'view_badge'),
(224,'Can add blog vote',44,'add_blogvote'),
(225,'Can change blog vote',44,'change_blogvote'),
(226,'Can delete blog vote',44,'delete_blogvote'),
(227,'Can view blog vote',44,'view_blogvote'),
(228,'Can add url',45,'add_url'),
(229,'Can change url',45,'change_url'),
(230,'Can delete url',45,'delete_url'),
(231,'Can view url',45,'view_url'),
(232,'Can add user session',46,'add_usersession'),
(233,'Can change user session',46,'change_usersession'),
(234,'Can delete user session',46,'delete_usersession'),
(235,'Can view user session',46,'view_usersession'),
(236,'Can add user activity',47,'add_useractivity'),
(237,'Can change user activity',47,'change_useractivity'),
(238,'Can delete user activity',47,'delete_useractivity'),
(239,'Can view user activity',47,'view_useractivity'),
(240,'Can add External Judge Configuration',48,'add_externaljudgeconfig'),
(241,'Can change External Judge Configuration',48,'change_externaljudgeconfig'),
(242,'Can delete External Judge Configuration',48,'delete_externaljudgeconfig'),
(243,'Can view External Judge Configuration',48,'view_externaljudgeconfig'),
(244,'Can add External Problem',49,'add_externalproblem'),
(245,'Can change External Problem',49,'change_externalproblem'),
(246,'Can delete External Problem',49,'delete_externalproblem'),
(247,'Can view External Problem',49,'view_externalproblem'),
(248,'Can add External Submission',50,'add_externalsubmission'),
(249,'Can change External Submission',50,'change_externalsubmission'),
(250,'Can delete External Submission',50,'delete_externalsubmission'),
(251,'Can view External Submission',50,'view_externalsubmission'),
(252,'Can add contest public ranking link',51,'add_contestpublicrankinglink'),
(253,'Can change contest public ranking link',51,'change_contestpublicrankinglink'),
(254,'Can delete contest public ranking link',51,'delete_contestpublicrankinglink'),
(255,'Can view contest public ranking link',51,'view_contestpublicrankinglink'),
(256,'Can add permission',52,'add_permission'),
(257,'Can change permission',52,'change_permission'),
(258,'Can delete permission',52,'delete_permission'),
(259,'Can view permission',52,'view_permission'),
(260,'Can add group',53,'add_group'),
(261,'Can change group',53,'change_group'),
(262,'Can delete group',53,'delete_group'),
(263,'Can view group',53,'view_group'),
(264,'Can add user',54,'add_user'),
(265,'Can change user',54,'change_user'),
(266,'Can delete user',54,'delete_user'),
(267,'Can view user',54,'view_user'),
(268,'Can add content type',55,'add_contenttype'),
(269,'Can change content type',55,'change_contenttype'),
(270,'Can delete content type',55,'delete_contenttype'),
(271,'Can view content type',55,'view_contenttype'),
(272,'Can add flat page',56,'add_flatpage'),
(273,'Can change flat page',56,'change_flatpage'),
(274,'Can delete flat page',56,'delete_flatpage'),
(275,'Can view flat page',56,'view_flatpage'),
(276,'Can add session',57,'add_session'),
(277,'Can change session',57,'change_session'),
(278,'Can delete session',57,'delete_session'),
(279,'Can view session',57,'view_session'),
(280,'Can add redirect',58,'add_redirect'),
(281,'Can change redirect',58,'change_redirect'),
(282,'Can delete redirect',58,'delete_redirect'),
(283,'Can view redirect',58,'view_redirect'),
(284,'Can add site',59,'add_site'),
(285,'Can change site',59,'change_site'),
(286,'Can delete site',59,'delete_site'),
(287,'Can view site',59,'view_site'),
(288,'Can add registration profile',60,'add_registrationprofile'),
(289,'Can change registration profile',60,'change_registrationprofile'),
(290,'Can delete registration profile',60,'delete_registrationprofile'),
(291,'Can view registration profile',60,'view_registrationprofile'),
(292,'Can add supervised registration profile',61,'add_supervisedregistrationprofile'),
(293,'Can change supervised registration profile',61,'change_supervisedregistrationprofile'),
(294,'Can delete supervised registration profile',61,'delete_supervisedregistrationprofile'),
(295,'Can view supervised registration profile',61,'view_supervisedregistrationprofile'),
(296,'Can add revision',62,'add_revision'),
(297,'Can change revision',62,'change_revision'),
(298,'Can delete revision',62,'delete_revision'),
(299,'Can view revision',62,'view_revision'),
(300,'Can add version',63,'add_version'),
(301,'Can change version',63,'change_version'),
(302,'Can delete version',63,'delete_version'),
(303,'Can view version',63,'view_version'),
(304,'Can add association',64,'add_association'),
(305,'Can change association',64,'change_association'),
(306,'Can delete association',64,'delete_association'),
(307,'Can view association',64,'view_association'),
(308,'Can add code',65,'add_code'),
(309,'Can change code',65,'change_code'),
(310,'Can delete code',65,'delete_code'),
(311,'Can view code',65,'view_code'),
(312,'Can add nonce',66,'add_nonce'),
(313,'Can change nonce',66,'change_nonce'),
(314,'Can delete nonce',66,'delete_nonce'),
(315,'Can view nonce',66,'view_nonce'),
(316,'Can add user social auth',67,'add_usersocialauth'),
(317,'Can change user social auth',67,'change_usersocialauth'),
(318,'Can delete user social auth',67,'delete_usersocialauth'),
(319,'Can view user social auth',67,'view_usersocialauth'),
(320,'Can add partial',68,'add_partial'),
(321,'Can change partial',68,'change_partial'),
(322,'Can delete partial',68,'delete_partial'),
(323,'Can view partial',68,'view_partial'),
(324,'Can add impersonation log',69,'add_impersonationlog'),
(325,'Can change impersonation log',69,'change_impersonationlog'),
(326,'Can delete impersonation log',69,'delete_impersonationlog'),
(327,'Can view impersonation log',69,'view_impersonationlog');
/*!40000 ALTER TABLE `auth_permission` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `auth_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `password` varchar(128) NOT NULL,
  `last_login` datetime(6) DEFAULT NULL,
  `is_superuser` tinyint(1) NOT NULL,
  `username` varchar(150) NOT NULL,
  `first_name` varchar(150) NOT NULL,
  `last_name` varchar(150) NOT NULL,
  `email` varchar(254) NOT NULL,
  `is_staff` tinyint(1) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `date_joined` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_user` WRITE;
/*!40000 ALTER TABLE `auth_user` DISABLE KEYS */;
INSERT INTO `auth_user` VALUES
(1,'pbkdf2_sha256$870000$vBt9RLpc5hhHL9qnMeQTNQ$ES8iCJNXAmbr6m3lYgMWLhVway9Qr/juzuMUnsZzjL8=',NULL,0,'alice','','','alice@example.com',0,1,'2026-10-02 03:12:11.716833'),
(2,'pbkdf2_sha256$870000$HV4sWoAC0ROALgPNC4yO0T$NchAZfteiHn5EZ4fR93ZE1/+GpVSqgdKwmedEOarxPw=',NULL,0,'bob','','','bob@example.com',0,1,'2026-10-02 03:12:11.868597'),
(3,'pbkdf2_sha256$870000$zHAHMcYvRuLwtT69UHffit$BIIezFd1Rs2Z++5tBZAtW9sfB/AHjeP3BWwrR+bZ69Q=',NULL,0,'robert','','','BOB@example.com',0,1,'2026-10-02 03:12:12.001507'),
(4,'pbkdf2_sha256$870000$3kpksoKGpFIEVnzGlEHuyx$ckyWS7nTVVs66jWINKdtu9BIAHH+17nBIT5B7b1FB6I=',NULL,0,'carol','','','carol@example.com',0,0,'2026-10-02 03:12:12.134014'),
(5,'md5$salt$abc',NULL,0,'dave','','','dave@example.com',0,1,'2026-10-02 03:12:12.268876'),
(6,'pbkdf2_sha256$870000$qN2vyK1PHzITvrS88qrXJo$sKGZkr014DBdOUawQab7VsO/zSod5YbISvD+oGs1u3Y=',NULL,0,'noprofile','','','np@example.com',0,1,'2026-10-02 03:12:12.272129');
/*!40000 ALTER TABLE `auth_user` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `auth_user_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_user_groups` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `group_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_user_groups_user_id_group_id_94350c0c_uniq` (`user_id`,`group_id`),
  KEY `auth_user_groups_group_id_97559544_fk_auth_group_id` (`group_id`),
  CONSTRAINT `auth_user_groups_group_id_97559544_fk_auth_group_id` FOREIGN KEY (`group_id`) REFERENCES `auth_group` (`id`),
  CONSTRAINT `auth_user_groups_user_id_6a12ed8b_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_user_groups` WRITE;
/*!40000 ALTER TABLE `auth_user_groups` DISABLE KEYS */;
INSERT INTO `auth_user_groups` VALUES
(1,1,1);
/*!40000 ALTER TABLE `auth_user_groups` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `auth_user_user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_user_user_permissions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_user_user_permissions_user_id_permission_id_14a6b632_uniq` (`user_id`,`permission_id`),
  KEY `auth_user_user_permi_permission_id_1fbb5f2c_fk_auth_perm` (`permission_id`),
  CONSTRAINT `auth_user_user_permi_permission_id_1fbb5f2c_fk_auth_perm` FOREIGN KEY (`permission_id`) REFERENCES `auth_permission` (`id`),
  CONSTRAINT `auth_user_user_permissions_user_id_a95ead1b_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `auth_user_user_permissions` WRITE;
/*!40000 ALTER TABLE `auth_user_user_permissions` DISABLE KEYS */;
INSERT INTO `auth_user_user_permissions` VALUES
(1,1,165);
/*!40000 ALTER TABLE `auth_user_user_permissions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_admin_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_admin_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action_time` datetime(6) NOT NULL,
  `object_id` longtext DEFAULT NULL,
  `object_repr` varchar(200) NOT NULL,
  `action_flag` smallint(5) unsigned NOT NULL CHECK (`action_flag` >= 0),
  `change_message` longtext NOT NULL,
  `content_type_id` int(11) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `django_admin_log_content_type_id_c4bce8eb_fk_django_co` (`content_type_id`),
  KEY `django_admin_log_user_id_c564eba6_fk_auth_user_id` (`user_id`),
  CONSTRAINT `django_admin_log_content_type_id_c4bce8eb_fk_django_co` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`),
  CONSTRAINT `django_admin_log_user_id_c564eba6_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_admin_log` WRITE;
/*!40000 ALTER TABLE `django_admin_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `django_admin_log` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_content_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_content_type` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `app_label` varchar(100) NOT NULL,
  `model` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `django_content_type_app_label_model_76bd3d3b_uniq` (`app_label`,`model`)
) ENGINE=InnoDB AUTO_INCREMENT=70 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_content_type` WRITE;
/*!40000 ALTER TABLE `django_content_type` DISABLE KEYS */;
INSERT INTO `django_content_type` VALUES
(1,'admin','logentry'),
(53,'auth','group'),
(52,'auth','permission'),
(54,'auth','user'),
(55,'contenttypes','contenttype'),
(56,'flatpages','flatpage'),
(69,'impersonate','impersonationlog'),
(43,'judge','badge'),
(2,'judge','blogpost'),
(44,'judge','blogvote'),
(3,'judge','comment'),
(4,'judge','commentlock'),
(5,'judge','commentvote'),
(6,'judge','contest'),
(42,'judge','contestannouncement'),
(35,'judge','contestmoss'),
(7,'judge','contestparticipation'),
(8,'judge','contestproblem'),
(51,'judge','contestpublicrankinglink'),
(9,'judge','contestsubmission'),
(10,'judge','contesttag'),
(48,'judge','externaljudgeconfig'),
(49,'judge','externalproblem'),
(50,'judge','externalsubmission'),
(37,'judge','generalissue'),
(11,'judge','judge'),
(12,'judge','language'),
(13,'judge','languagelimit'),
(14,'judge','license'),
(15,'judge','miscconfig'),
(16,'judge','navigationbar'),
(17,'judge','organization'),
(18,'judge','organizationrequest'),
(19,'judge','problem'),
(20,'judge','problemclarification'),
(21,'judge','problemdata'),
(22,'judge','problemgroup'),
(23,'judge','problemtestcase'),
(24,'judge','problemtranslation'),
(25,'judge','problemtype'),
(26,'judge','profile'),
(27,'judge','rating'),
(28,'judge','runtimeversion'),
(29,'judge','solution'),
(30,'judge','submission'),
(34,'judge','submissionsource'),
(31,'judge','submissiontestcase'),
(38,'judge','tag'),
(39,'judge','tagdata'),
(40,'judge','taggroup'),
(41,'judge','tagproblem'),
(32,'judge','ticket'),
(33,'judge','ticketmessage'),
(45,'judge','url'),
(47,'judge','useractivity'),
(46,'judge','usersession'),
(36,'judge','webauthncredential'),
(58,'redirects','redirect'),
(60,'registration','registrationprofile'),
(61,'registration','supervisedregistrationprofile'),
(62,'reversion','revision'),
(63,'reversion','version'),
(57,'sessions','session'),
(59,'sites','site'),
(64,'social_django','association'),
(65,'social_django','code'),
(66,'social_django','nonce'),
(68,'social_django','partial'),
(67,'social_django','usersocialauth');
/*!40000 ALTER TABLE `django_content_type` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_flatpage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_flatpage` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `url` varchar(100) NOT NULL,
  `title` varchar(200) NOT NULL,
  `content` longtext NOT NULL,
  `enable_comments` tinyint(1) NOT NULL,
  `template_name` varchar(70) NOT NULL,
  `registration_required` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `django_flatpage_url_41612362` (`url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_flatpage` WRITE;
/*!40000 ALTER TABLE `django_flatpage` DISABLE KEYS */;
/*!40000 ALTER TABLE `django_flatpage` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_flatpage_sites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_flatpage_sites` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `flatpage_id` int(11) NOT NULL,
  `site_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `django_flatpage_sites_flatpage_id_site_id_0d29d9d1_uniq` (`flatpage_id`,`site_id`),
  KEY `django_flatpage_sites_site_id_bfd8ea84_fk_django_site_id` (`site_id`),
  CONSTRAINT `django_flatpage_sites_flatpage_id_078bbc8b_fk_django_flatpage_id` FOREIGN KEY (`flatpage_id`) REFERENCES `django_flatpage` (`id`),
  CONSTRAINT `django_flatpage_sites_site_id_bfd8ea84_fk_django_site_id` FOREIGN KEY (`site_id`) REFERENCES `django_site` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_flatpage_sites` WRITE;
/*!40000 ALTER TABLE `django_flatpage_sites` DISABLE KEYS */;
/*!40000 ALTER TABLE `django_flatpage_sites` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_migrations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `app` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `applied` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=275 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_migrations` WRITE;
/*!40000 ALTER TABLE `django_migrations` DISABLE KEYS */;
INSERT INTO `django_migrations` VALUES
(1,'contenttypes','0001_initial','2026-10-02 03:11:47.875025'),
(2,'auth','0001_initial','2026-10-02 03:11:48.081869'),
(3,'admin','0001_initial','2026-10-02 03:11:48.130236'),
(4,'admin','0002_logentry_remove_auto_add','2026-10-02 03:11:48.136465'),
(5,'admin','0003_logentry_add_action_flag_choices','2026-10-02 03:11:48.142685'),
(6,'contenttypes','0002_remove_content_type_name','2026-10-02 03:11:48.179736'),
(7,'auth','0002_alter_permission_name_max_length','2026-10-02 03:11:48.200668'),
(8,'auth','0003_alter_user_email_max_length','2026-10-02 03:11:48.214888'),
(9,'auth','0004_alter_user_username_opts','2026-10-02 03:11:48.220619'),
(10,'auth','0005_alter_user_last_login_null','2026-10-02 03:11:48.240443'),
(11,'auth','0006_require_contenttypes_0002','2026-10-02 03:11:48.241503'),
(12,'auth','0007_alter_validators_add_error_messages','2026-10-02 03:11:48.247257'),
(13,'auth','0008_alter_user_username_max_length','2026-10-02 03:11:48.263277'),
(14,'auth','0009_alter_user_last_name_max_length','2026-10-02 03:11:48.276187'),
(15,'auth','0010_alter_group_name_max_length','2026-10-02 03:11:48.290073'),
(16,'auth','0011_update_proxy_permissions','2026-10-02 03:11:48.296858'),
(17,'auth','0012_alter_user_first_name_max_length','2026-10-02 03:11:48.308968'),
(18,'sites','0001_initial','2026-10-02 03:11:48.316176'),
(19,'flatpages','0001_initial','2026-10-02 03:11:48.388752'),
(20,'impersonate','0001_initial','2026-10-02 03:11:48.435936'),
(21,'judge','0001_initial','2026-10-02 03:11:52.143100'),
(22,'judge','0002_license','2026-10-02 03:11:52.144216'),
(23,'judge','0003_license_key','2026-10-02 03:11:52.145137'),
(24,'judge','0004_language_limit','2026-10-02 03:11:52.146018'),
(25,'judge','0005_nav_path_len','2026-10-02 03:11:52.146881'),
(26,'judge','0006_language_extension','2026-10-02 03:11:52.147748'),
(27,'judge','0007_test_site_perm','2026-10-02 03:11:52.148603'),
(28,'judge','0008_contestproblem_order','2026-10-02 03:11:52.149450'),
(29,'judge','0009_solution_problem','2026-10-02 03:11:52.150282'),
(30,'judge','0010_comment_page_index','2026-10-02 03:11:52.151127'),
(31,'judge','0011_organization_is_open','2026-10-02 03:11:52.151939'),
(32,'judge','0012_organization_perms','2026-10-02 03:11:52.152741'),
(33,'judge','0013_private_contests','2026-10-02 03:11:52.153517'),
(34,'judge','0014_multi_organization','2026-10-02 03:11:52.154284'),
(35,'judge','0015_remove_single_organization','2026-10-02 03:11:52.155050'),
(36,'judge','0016_organizationrequest','2026-10-02 03:11:52.155813'),
(37,'judge','0017_edit_public_problem_perm','2026-10-02 03:11:52.156590'),
(38,'judge','0018_django_1_9','2026-10-02 03:11:52.157362'),
(39,'judge','0019_og_images','2026-10-02 03:11:52.158149'),
(40,'judge','0020_profile_user_script','2026-10-02 03:11:52.158914'),
(41,'judge','0021_output_prefix_override','2026-10-02 03:11:52.159709'),
(42,'judge','0022_judge_last_ping','2026-10-02 03:11:52.160485'),
(43,'judge','0023_contest_tag','2026-10-02 03:11:52.161263'),
(44,'judge','0024_submission_judge','2026-10-02 03:11:52.162046'),
(45,'judge','0025_submission_rejudge_flag','2026-10-02 03:11:52.163603'),
(46,'judge','0026_change_public_visibility_perm','2026-10-02 03:11:52.164485'),
(47,'judge','0027_bridge_revert','2026-10-02 03:11:52.165539'),
(48,'judge','0028_judge_ip','2026-10-02 03:11:52.166405'),
(49,'judge','0029_problem_translation','2026-10-02 03:11:52.167260'),
(50,'judge','0030_remove_contest_profile','2026-10-02 03:11:52.168112'),
(51,'judge','0031_judge_versions','2026-10-02 03:11:52.168984'),
(52,'judge','0032_hide_problem_tags_in_contest','2026-10-02 03:11:52.169831'),
(53,'judge','0033_proper_pretest_support','2026-10-02 03:11:52.170684'),
(54,'judge','0034_submission_is_pretested','2026-10-02 03:11:52.171531'),
(55,'judge','0035_contest_spectate_mode','2026-10-02 03:11:52.172392'),
(56,'judge','0036_contest_participation_unique','2026-10-02 03:11:52.173235'),
(57,'judge','0037_user_count_ac_rate_field','2026-10-02 03:11:52.174093'),
(58,'judge','0038_profile_problem_count','2026-10-02 03:11:52.174969'),
(59,'judge','0039_remove_contest_is_external','2026-10-02 03:11:52.175821'),
(60,'judge','0040_profile_math_engine','2026-10-02 03:11:52.176666'),
(61,'judge','0041_virtual_contest_participation','2026-10-02 03:11:52.177478'),
(62,'judge','0042_remove_spectate_field','2026-10-02 03:11:52.178274'),
(63,'judge','0043_contest_user_count','2026-10-02 03:11:52.179070'),
(64,'judge','0044_organization_slots','2026-10-02 03:11:52.179856'),
(65,'judge','0045_organization_access_code','2026-10-02 03:11:52.180634'),
(66,'judge','0046_blogpost_authors','2026-10-02 03:11:52.181431'),
(67,'judge','0047_site_managed_data','2026-10-02 03:11:52.182232'),
(68,'judge','0048_site_managed_checkers','2026-10-02 03:11:52.183694'),
(69,'judge','0049_contest_summary','2026-10-02 03:11:52.184490'),
(70,'judge','0050_problem_tester_field','2026-10-02 03:11:52.185281'),
(71,'judge','0051_was_rejudged_field','2026-10-02 03:11:52.186081'),
(72,'judge','0052_switch_to_durationfield','2026-10-02 03:11:52.186861'),
(73,'judge','0053_opengraph_problems','2026-10-02 03:11:52.187663'),
(74,'judge','0054_tickets','2026-10-02 03:11:52.188437'),
(75,'judge','0055_add_performance_points','2026-10-02 03:11:52.189204'),
(76,'judge','0056_ticket_is_open','2026-10-02 03:11:52.189995'),
(77,'judge','0057_blue_pretests','2026-10-02 03:11:52.190784'),
(78,'judge','0058_problem_curator_field','2026-10-02 03:11:52.191597'),
(79,'judge','0059_problem_is_manually_managed','2026-10-02 03:11:52.192387'),
(80,'judge','0060_contest_clarifications','2026-10-02 03:11:52.193191'),
(81,'judge','0061_language_template','2026-10-02 03:11:52.193991'),
(82,'judge','0062_add_contest_submission_limit','2026-10-02 03:11:52.194797'),
(83,'judge','0063_new_solutions','2026-10-02 03:11:52.195641'),
(84,'judge','0064_unique_solution','2026-10-02 03:11:52.196450'),
(85,'judge','0065_blogpost_perms','2026-10-02 03:11:52.197259'),
(86,'judge','0066_submission_date_index','2026-10-02 03:11:52.198072'),
(87,'judge','0067_contest_access_code','2026-10-02 03:11:52.198873'),
(88,'judge','0068_hide_scoreboard','2026-10-02 03:11:52.200473'),
(89,'judge','0069_judge_blocking','2026-10-02 03:11:52.201332'),
(90,'judge','0070_organization_slug','2026-10-02 03:11:52.202126'),
(91,'judge','0071_organization_private_problems','2026-10-02 03:11:52.202903'),
(92,'judge','0072_contest_logo_override_image','2026-10-02 03:11:52.203694'),
(93,'judge','0073_comment_lock','2026-10-02 03:11:52.204460'),
(94,'judge','0074_totp','2026-10-02 03:11:52.205242'),
(95,'judge','0075_organization_admin_reverse','2026-10-02 03:11:52.206033'),
(96,'judge','0076_problem_statistics','2026-10-02 03:11:52.206805'),
(97,'judge','0077_remove_organization_key','2026-10-02 03:11:52.207585'),
(98,'judge','0078_add_user_notes','2026-10-02 03:11:52.208357'),
(99,'judge','0079_remove_comment_title','2026-10-02 03:11:52.209135'),
(100,'judge','0080_contest_banned_users','2026-10-02 03:11:52.209937'),
(101,'judge','0081_unlisted_users','2026-10-02 03:11:52.210740'),
(102,'judge','0082_remove_profile_name','2026-10-02 03:11:52.211508'),
(103,'judge','0083_extended_feedback','2026-10-02 03:11:52.212292'),
(104,'judge','0084_contest_formats','2026-10-02 03:11:52.213075'),
(105,'judge','0085_submission_source','2026-10-02 03:11:52.340446'),
(106,'judge','0086_rating_ceiling','2026-10-02 03:11:52.412167'),
(107,'judge','0087_problem_resource_limits','2026-10-02 03:11:52.622495'),
(108,'judge','0088_private_contests','2026-10-02 03:11:52.841320'),
(109,'judge','0089_submission_to_contest','2026-10-02 03:11:52.911088'),
(110,'judge','0090_fix_contest_visibility','2026-10-02 03:11:52.914413'),
(111,'judge','0091_compiler_message_ansi2html','2026-10-02 03:11:52.948667'),
(112,'judge','0092_contest_clone','2026-10-02 03:11:52.978489'),
(113,'judge','0093_contest_moss','2026-10-02 03:11:53.253498'),
(114,'judge','0094_submissiontestcase_unique_together','2026-10-02 03:11:53.285318'),
(115,'judge','0095_organization_logo_override','2026-10-02 03:11:53.328710'),
(116,'judge','0096_profile_language_set_default','2026-10-02 03:11:53.479567'),
(117,'judge','0097_participation_is_disqualified','2026-10-02 03:11:53.544351'),
(118,'judge','0098_view_contest_scoreboard','2026-10-02 03:11:53.633814'),
(119,'judge','0099_contest_problem_label','2026-10-02 03:11:53.702827'),
(120,'judge','0100_contest_visiblity_permission','2026-10-02 03:11:53.834023'),
(121,'judge','0101_submission_judged_date','2026-10-02 03:11:53.876293'),
(122,'judge','0102_api_token','2026-10-02 03:11:53.912954'),
(123,'judge','0103_contest_participation_tiebreak_field','2026-10-02 03:11:53.955839'),
(124,'judge','0104_contestproblem_maxsubs','2026-10-02 03:11:54.040614'),
(125,'judge','0105_webauthn','2026-10-02 03:11:54.146152'),
(126,'judge','0106_user_data_download','2026-10-02 03:11:54.183894'),
(127,'judge','0107_submission_lock','2026-10-02 03:11:54.484451'),
(128,'judge','0108_bleach_problems','2026-10-02 03:11:54.560224'),
(129,'judge','0109_scratch_codes','2026-10-02 03:11:54.597606'),
(130,'judge','0110_default_output_prefix_override','2026-10-02 03:11:54.632636'),
(131,'judge','0111_blank_assignees_ticket','2026-10-02 03:11:54.669313'),
(132,'judge','0112_language_extensions','2026-10-02 03:11:54.711671'),
(133,'judge','0113_contest_decimal_points','2026-10-02 03:11:54.919312'),
(134,'judge','0114_add_custom_python_checker','2026-10-02 03:11:56.067564'),
(135,'judge','0115_add_custom_cpp_checker','2026-10-02 03:11:56.140805'),
(136,'judge','0116_add_is_polygon_field','2026-10-02 03:11:56.302117'),
(137,'judge','0117_change_default_timezone','2026-10-02 03:11:56.338497'),
(138,'judge','0118_remove_problem_is_polygon_problem','2026-10-02 03:11:56.378870'),
(139,'judge','0119_remove_py_cpp_checker','2026-10-02 03:11:56.478407'),
(140,'judge','0120_allow_py_cpp_files_in_custom_checker','2026-10-02 03:11:56.499372'),
(141,'judge','0114_remove_org_registrant','2026-10-02 03:11:56.593042'),
(142,'judge','0121_merge_20210410_0643','2026-10-02 03:11:56.594187'),
(143,'judge','0122_allow_underscore_problemcode','2026-10-02 03:11:56.628510'),
(144,'judge','0115_contest_scoreboard_visibility','2026-10-02 03:11:56.848348'),
(145,'judge','0123_merge_20210419_0859','2026-10-02 03:11:56.849425'),
(146,'judge','0124_32char_and_underscore_problem_and_contest_id','2026-10-02 03:11:56.938345'),
(147,'judge','0125_add_problem_pdf_statement','2026-10-02 03:11:56.989540'),
(148,'judge','0126_allow_blank_desscription','2026-10-02 03:11:57.023903'),
(149,'judge','0127_Add_contribution_points_and_misc','2026-10-02 03:11:57.114998'),
(150,'judge','0128_ticket_is_contributive','2026-10-02 03:11:57.155595'),
(151,'judge','0127_add_organization_performance_points','2026-10-02 03:11:57.196663'),
(152,'judge','0129_merge_20210504_1441','2026-10-02 03:11:57.197749'),
(153,'judge','0130_contest_virtual_count','2026-10-02 03:11:57.342511'),
(154,'judge','0116_contest_curator_and_tester','2026-10-02 03:11:57.585724'),
(155,'judge','0117_remove_private_messages','2026-10-02 03:11:57.635517'),
(156,'judge','0118_convert_to_dates','2026-10-02 03:11:58.007686'),
(157,'judge','0131_merge_migration_0130_0118','2026-10-02 03:11:58.008833'),
(158,'judge','0132_organization_member_count','2026-10-02 03:11:58.085075'),
(159,'judge','0133_add_GeneralIssue_model','2026-10-02 03:11:58.105423'),
(160,'judge','0119_hide_problem_authors','2026-10-02 03:11:58.154159'),
(161,'judge','0134_merge_0119_0133','2026-10-02 03:11:58.155298'),
(162,'judge','0135_add_field_source_to_problem','2026-10-02 03:11:58.215705'),
(163,'judge','0136_add_field_csv_ranking_to_contest','2026-10-02 03:11:58.255315'),
(164,'judge','0137_add_field_suggester_to_problem','2026-10-02 03:11:58.489510'),
(165,'judge','0138_alter_field_pdf_url_on_problem','2026-10-02 03:11:58.533830'),
(166,'judge','0139_add_can_upload_image_permission','2026-10-02 03:11:58.561114'),
(167,'judge','0140_problem_banned_judges','2026-10-02 03:11:58.646873'),
(168,'judge','0141_add_model_tag','2026-10-02 03:11:58.983808'),
(169,'judge','0142_add_index','2026-10-02 03:11:59.304459'),
(170,'judge','0143_change_field_name','2026-10-02 03:11:59.397244'),
(171,'judge','0144_add_create_org_problem_permission','2026-10-02 03:11:59.428371'),
(172,'judge','0145_alter_problem_pdf_url','2026-10-02 03:11:59.497582'),
(173,'judge','0146_submit_via_file','2026-10-02 03:11:59.868347'),
(174,'judge','0147_allow_custom_grader','2026-10-02 03:12:00.001977'),
(175,'judge','0148_add_output_only','2026-10-02 03:12:00.069235'),
(176,'judge','0149_totp_no_reuse','2026-10-02 03:12:00.114768'),
(177,'judge','0150_per_problem_sub_access_control','2026-10-02 03:12:00.160001'),
(178,'judge','0151_contest_rating_elo_mmr','2026-10-02 03:12:00.428904'),
(179,'judge','0152_contest_show_short_display','2026-10-02 03:12:00.474480'),
(180,'judge','0153_new_roles','2026-10-02 03:12:00.509845'),
(181,'judge','0154_blog_post_org','2026-10-02 03:12:00.656301'),
(182,'judge','0155_contest_announcement','2026-10-02 03:12:00.859769'),
(183,'judge','0156_always_hidden_scoreboard','2026-10-02 03:12:00.889502'),
(184,'judge','0157_banned_judges_for_contest','2026-10-02 03:12:01.019538'),
(185,'judge','0158_unlisted_org','2026-10-02 03:12:01.106862'),
(186,'judge','0159_create_org','2026-10-02 03:12:01.166629'),
(187,'judge','0160_add_limit_perms','2026-10-02 03:12:01.300277'),
(188,'judge','0161_add_create_mass_testcases_perm','2026-10-02 03:12:01.333071'),
(189,'judge','0162_add_testcase_visibility','2026-10-02 03:12:01.383476'),
(190,'judge','0163_add_ban_reason','2026-10-02 03:12:01.496030'),
(191,'judge','0164_add_frozen_fields','2026-10-02 03:12:01.697097'),
(192,'judge','0165_contest_show_submission_list','2026-10-02 03:12:01.850232'),
(193,'judge','0166_contest_scoreboard_cache_timeout','2026-10-02 03:12:01.899032'),
(194,'judge','0167_profile_username_display_override','2026-10-02 03:12:01.948456'),
(195,'judge','0168_alter_allow_tagging','2026-10-02 03:12:02.032528'),
(196,'judge','0169_alter_contestformat_and_custom_checker','2026-10-02 03:12:02.085330'),
(197,'judge','0170_contest_data_download','2026-10-02 03:12:02.127470'),
(198,'judge','0171_set_default_grader_checker','2026-10-02 03:12:02.171059'),
(199,'judge','0172_contest_disallow_virtual','2026-10-02 03:12:02.219581'),
(200,'judge','0173_add_view_feedback','2026-10-02 03:12:02.464625'),
(201,'judge','0174_model_badge','2026-10-02 03:12:02.643227'),
(202,'judge','0175_model_blogvote','2026-10-02 03:12:02.780351'),
(203,'judge','0176_no_self_vote','2026-10-02 03:12:02.823365'),
(204,'judge','0177_testcase_result_visibility','2026-10-02 03:12:02.952356'),
(205,'judge','0178_add_java_checker','2026-10-02 03:12:03.081848'),
(206,'judge','0179_add_ranking_access_code','2026-10-02 03:12:03.130722'),
(207,'judge','0180_add_problem_data_hints','2026-10-02 03:12:03.326858'),
(208,'judge','0181_disable_judge','2026-10-02 03:12:03.368457'),
(209,'judge','0182_remove_zombie_editorials','2026-10-02 03:12:03.574529'),
(210,'judge','0183_fix_problem_data','2026-10-02 03:12:03.637906'),
(211,'judge','0184_profile_site_theme','2026-10-02 03:12:03.751636'),
(212,'judge','0185_dark_ace_theme','2026-10-02 03:12:03.821448'),
(213,'judge','0186_user_index_refactor','2026-10-02 03:12:04.274357'),
(214,'judge','0187_submission_index_refactor','2026-10-02 03:12:04.661278'),
(215,'judge','0188_submission_extra_index','2026-10-02 03:12:04.961562'),
(216,'judge','0189_comment_revision_count','2026-10-02 03:12:05.038130'),
(217,'judge','0190_contest_problem_rank_index','2026-10-02 03:12:05.082789'),
(218,'judge','0191_submission_index_cleanup','2026-10-02 03:12:05.634937'),
(219,'judge','0192_add_registration_fields','2026-10-02 03:12:05.714440'),
(220,'judge','0193_unique_organization_slug','2026-10-02 03:12:05.809977'),
(221,'judge','0194_ban_permission','2026-10-02 03:12:05.839799'),
(222,'judge','0195_post_pin_global_permissions','2026-10-02 03:12:05.863472'),
(223,'judge','0196_view_all_user_comment_permission','2026-10-02 03:12:05.886820'),
(224,'judge','0197_org_slugs_begin_with_letter','2026-10-02 03:12:05.921778'),
(225,'judge','0198_submission_max_time','2026-10-02 03:12:05.927644'),
(226,'judge','0199_change_min_time_limit','2026-10-02 03:12:06.104119'),
(227,'judge','0200_update_show_submission_list','2026-10-02 03:12:06.135187'),
(228,'judge','0201_update_profile_site_theme','2026-10-02 03:12:06.173404'),
(229,'judge','0202_import_polygon_package','2026-10-02 03:12:06.202447'),
(230,'judge','0203_alter_profile_timezone','2026-10-02 03:12:06.237910'),
(231,'judge','0204_problem_problem_material','2026-10-02 03:12:06.287210'),
(232,'judge','0205_add_reject_submission','2026-10-02 03:12:06.486490'),
(233,'judge','0206_alter_contest_format_name','2026-10-02 03:12:06.518973'),
(234,'judge','0207_alter_problemdata_custom_checker','2026-10-02 03:12:06.541581'),
(235,'judge','0208_contesttag_full_name','2026-10-02 03:12:06.565721'),
(236,'judge','0209_navigationbar_hidden','2026-10-02 03:12:06.585945'),
(237,'judge','0210_scale_problem_points','2026-10-02 03:12:06.724306'),
(238,'judge','0211_url','2026-10-02 03:12:06.733132'),
(239,'judge','0212_auto_20240810_0642','2026-10-02 03:12:07.029859'),
(240,'judge','0213_alter_profile_timezone','2026-10-02 03:12:07.068331'),
(241,'judge','0214_create_user_activity_models','2026-10-02 03:12:07.286508'),
(242,'judge','0215_add_final_submission_format','2026-10-02 03:12:07.320572'),
(243,'judge','0216_problem_mirroring','2026-10-02 03:12:07.460344'),
(244,'judge','0217_external_judge','2026-10-02 03:12:07.765731'),
(245,'judge','0218_contestpublicrankinglink','2026-10-02 03:12:07.834458'),
(246,'redirects','0001_initial','2026-10-02 03:12:07.887079'),
(247,'redirects','0002_alter_redirect_new_path_help_text','2026-10-02 03:12:07.892036'),
(248,'registration','0001_initial','2026-10-02 03:12:07.960168'),
(249,'registration','0002_registrationprofile_activated','2026-10-02 03:12:07.989552'),
(250,'registration','0003_migrate_activatedstatus','2026-10-02 03:12:08.031434'),
(251,'registration','0004_supervisedregistrationprofile','2026-10-02 03:12:08.087438'),
(252,'registration','0005_activation_key_sha256','2026-10-02 03:12:08.115698'),
(253,'reversion','0001_squashed_0004_auto_20160611_1202','2026-10-02 03:12:08.380758'),
(254,'reversion','0002_add_index_on_version_for_content_type_and_db','2026-10-02 03:12:08.402735'),
(255,'sessions','0001_initial','2026-10-02 03:12:08.422694'),
(256,'sites','0002_alter_domain_unique','2026-10-02 03:12:08.438907'),
(257,'social_django','0001_initial','2026-10-02 03:12:08.583947'),
(258,'social_django','0002_add_related_name','2026-10-02 03:12:08.626108'),
(259,'social_django','0003_alter_email_max_length','2026-10-02 03:12:08.641184'),
(260,'social_django','0004_auto_20160423_0400','2026-10-02 03:12:08.652436'),
(261,'social_django','0005_auto_20160727_2333','2026-10-02 03:12:08.671035'),
(262,'social_django','0006_partial','2026-10-02 03:12:08.690943'),
(263,'social_django','0007_code_timestamp','2026-10-02 03:12:08.724095'),
(264,'social_django','0008_partial_timestamp','2026-10-02 03:12:08.756160'),
(265,'social_django','0009_auto_20191118_0520','2026-10-02 03:12:08.817284'),
(266,'social_django','0010_uid_db_index','2026-10-02 03:12:08.842941'),
(267,'social_django','0011_alter_id_fields','2026-10-02 03:12:08.962423'),
(268,'social_django','0012_usersocialauth_extra_data_new','2026-10-02 03:12:09.012146'),
(269,'social_django','0013_migrate_extra_data','2026-10-02 03:12:09.058782'),
(270,'social_django','0014_remove_usersocialauth_extra_data','2026-10-02 03:12:09.091830'),
(271,'social_django','0015_rename_extra_data_new_usersocialauth_extra_data','2026-10-02 03:12:09.128583'),
(272,'social_django','0016_alter_usersocialauth_extra_data','2026-10-02 03:12:09.139909'),
(273,'social_django','0017_usersocialauth_user_social_auth_uid_required','2026-10-02 03:12:09.169229'),
(274,'judge','0001_squashed_0084_contest_formats','2026-10-02 03:12:09.172622');
/*!40000 ALTER TABLE `django_migrations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_redirect`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_redirect` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site_id` int(11) NOT NULL,
  `old_path` varchar(200) NOT NULL,
  `new_path` varchar(200) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `django_redirect_site_id_old_path_ac5dd16b_uniq` (`site_id`,`old_path`),
  KEY `django_redirect_old_path_c6cc94d3` (`old_path`),
  CONSTRAINT `django_redirect_site_id_c3e37341_fk_django_site_id` FOREIGN KEY (`site_id`) REFERENCES `django_site` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_redirect` WRITE;
/*!40000 ALTER TABLE `django_redirect` DISABLE KEYS */;
/*!40000 ALTER TABLE `django_redirect` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_session` (
  `session_key` varchar(40) NOT NULL,
  `session_data` longtext NOT NULL,
  `expire_date` datetime(6) NOT NULL,
  PRIMARY KEY (`session_key`),
  KEY `django_session_expire_date_a5c62663` (`expire_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_session` WRITE;
/*!40000 ALTER TABLE `django_session` DISABLE KEYS */;
/*!40000 ALTER TABLE `django_session` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `django_site`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `django_site` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `domain` varchar(100) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `django_site_domain_a2e37b91_uniq` (`domain`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `django_site` WRITE;
/*!40000 ALTER TABLE `django_site` DISABLE KEYS */;
INSERT INTO `django_site` VALUES
(1,'example.com','example.com');
/*!40000 ALTER TABLE `django_site` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `impersonate_impersonationlog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `impersonate_impersonationlog` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `session_key` varchar(40) NOT NULL,
  `session_started_at` datetime(6) DEFAULT NULL,
  `session_ended_at` datetime(6) DEFAULT NULL,
  `impersonating_id` int(11) NOT NULL,
  `impersonator_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `impersonate_imperson_impersonating_id_afd114fc_fk_auth_user` (`impersonating_id`),
  KEY `impersonate_imperson_impersonator_id_1ecfe8ce_fk_auth_user` (`impersonator_id`),
  CONSTRAINT `impersonate_imperson_impersonating_id_afd114fc_fk_auth_user` FOREIGN KEY (`impersonating_id`) REFERENCES `auth_user` (`id`),
  CONSTRAINT `impersonate_imperson_impersonator_id_1ecfe8ce_fk_auth_user` FOREIGN KEY (`impersonator_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `impersonate_impersonationlog` WRITE;
/*!40000 ALTER TABLE `impersonate_impersonationlog` DISABLE KEYS */;
/*!40000 ALTER TABLE `impersonate_impersonationlog` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_badge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_badge` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `mini` varchar(200) NOT NULL,
  `full_size` varchar(200) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_badge` WRITE;
/*!40000 ALTER TABLE `judge_badge` DISABLE KEYS */;
INSERT INTO `judge_badge` VALUES
(1,'Gold','','');
/*!40000 ALTER TABLE `judge_badge` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_blogpost`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_blogpost` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(100) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `visible` tinyint(1) NOT NULL,
  `sticky` tinyint(1) NOT NULL,
  `publish_on` datetime(6) NOT NULL,
  `content` longtext NOT NULL,
  `summary` longtext NOT NULL,
  `og_image` varchar(150) NOT NULL,
  `global_post` tinyint(1) NOT NULL,
  `organization_id` int(11) DEFAULT NULL,
  `score` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_blogpost_slug_eb303bae` (`slug`),
  KEY `judge_blogpost_organization_id_d1eb4e89_fk_judge_organization_id` (`organization_id`),
  CONSTRAINT `judge_blogpost_organization_id_d1eb4e89_fk_judge_organization_id` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_blogpost` WRITE;
/*!40000 ALTER TABLE `judge_blogpost` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_blogpost` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_blogpost_authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_blogpost_authors` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `blogpost_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_blogpost_authors_blogpost_id_profile_id_e53f2daf_uniq` (`blogpost_id`,`profile_id`),
  KEY `judge_blogpost_authors_profile_id_18d1d3e2_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_blogpost_authors_blogpost_id_43745d7c_fk_judge_blogpost_id` FOREIGN KEY (`blogpost_id`) REFERENCES `judge_blogpost` (`id`),
  CONSTRAINT `judge_blogpost_authors_profile_id_18d1d3e2_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_blogpost_authors` WRITE;
/*!40000 ALTER TABLE `judge_blogpost_authors` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_blogpost_authors` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_blogvote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_blogvote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `score` int(11) NOT NULL,
  `blog_id` int(11) NOT NULL,
  `voter_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_blogvote_voter_id_blog_id_ac6e59be_uniq` (`voter_id`,`blog_id`),
  KEY `judge_blogvote_blog_id_9fe4f241_fk_judge_blogpost_id` (`blog_id`),
  CONSTRAINT `judge_blogvote_blog_id_9fe4f241_fk_judge_blogpost_id` FOREIGN KEY (`blog_id`) REFERENCES `judge_blogpost` (`id`),
  CONSTRAINT `judge_blogvote_voter_id_49ace0bf_fk_judge_profile_id` FOREIGN KEY (`voter_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_blogvote` WRITE;
/*!40000 ALTER TABLE `judge_blogvote` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_blogvote` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_comment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_comment` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `time` datetime(6) NOT NULL,
  `page` varchar(34) NOT NULL,
  `score` int(11) NOT NULL,
  `body` longtext NOT NULL,
  `hidden` tinyint(1) NOT NULL,
  `lft` int(10) unsigned NOT NULL CHECK (`lft` >= 0),
  `rght` int(10) unsigned NOT NULL CHECK (`rght` >= 0),
  `tree_id` int(10) unsigned NOT NULL CHECK (`tree_id` >= 0),
  `level` int(10) unsigned NOT NULL CHECK (`level` >= 0),
  `author_id` int(11) NOT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `revisions` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_comment_author_id_ec3f8371_fk_judge_profile_id` (`author_id`),
  KEY `judge_comment_page_66eb6c11` (`page`),
  KEY `judge_comment_tree_id_cdde24bd` (`tree_id`),
  KEY `judge_comment_parent_id_e16fe797` (`parent_id`),
  CONSTRAINT `judge_comment_author_id_ec3f8371_fk_judge_profile_id` FOREIGN KEY (`author_id`) REFERENCES `judge_profile` (`id`),
  CONSTRAINT `judge_comment_parent_id_e16fe797_fk_judge_comment_id` FOREIGN KEY (`parent_id`) REFERENCES `judge_comment` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_comment` WRITE;
/*!40000 ALTER TABLE `judge_comment` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_comment` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_commentlock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_commentlock` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `page` varchar(34) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_commentlock_page_3aec2c30` (`page`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_commentlock` WRITE;
/*!40000 ALTER TABLE `judge_commentlock` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_commentlock` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_commentvote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_commentvote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `score` int(11) NOT NULL,
  `comment_id` int(11) NOT NULL,
  `voter_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_commentvote_voter_id_comment_id_2fa9cd9b_uniq` (`voter_id`,`comment_id`),
  KEY `judge_commentvote_comment_id_9711d946_fk_judge_comment_id` (`comment_id`),
  CONSTRAINT `judge_commentvote_comment_id_9711d946_fk_judge_comment_id` FOREIGN KEY (`comment_id`) REFERENCES `judge_comment` (`id`),
  CONSTRAINT `judge_commentvote_voter_id_49326699_fk_judge_profile_id` FOREIGN KEY (`voter_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_commentvote` WRITE;
/*!40000 ALTER TABLE `judge_commentvote` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_commentvote` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` longtext NOT NULL,
  `start_time` datetime(6) NOT NULL,
  `end_time` datetime(6) NOT NULL,
  `time_limit` bigint(20) DEFAULT NULL,
  `is_visible` tinyint(1) NOT NULL,
  `is_rated` tinyint(1) NOT NULL,
  `use_clarifications` tinyint(1) NOT NULL,
  `rate_all` tinyint(1) NOT NULL,
  `is_private` tinyint(1) NOT NULL,
  `hide_problem_tags` tinyint(1) NOT NULL,
  `run_pretests_only` tinyint(1) NOT NULL,
  `og_image` varchar(150) NOT NULL,
  `logo_override_image` varchar(150) NOT NULL,
  `user_count` int(11) NOT NULL,
  `summary` longtext NOT NULL,
  `access_code` varchar(255) NOT NULL,
  `format_name` varchar(32) NOT NULL,
  `format_config` longtext DEFAULT NULL,
  `rating_ceiling` int(11) DEFAULT NULL,
  `rating_floor` int(11) DEFAULT NULL,
  `is_organization_private` tinyint(1) NOT NULL,
  `problem_label_script` longtext NOT NULL,
  `points_precision` int(11) NOT NULL,
  `scoreboard_visibility` varchar(1) NOT NULL,
  `virtual_count` int(11) NOT NULL,
  `locked_after` datetime(6) DEFAULT NULL,
  `hide_problem_authors` tinyint(1) NOT NULL,
  `csv_ranking` longtext NOT NULL,
  `show_short_display` tinyint(1) NOT NULL,
  `push_announcements` tinyint(1) NOT NULL,
  `frozen_last_minutes` int(11) NOT NULL,
  `show_submission_list` tinyint(1) NOT NULL,
  `scoreboard_cache_timeout` int(10) unsigned NOT NULL CHECK (`scoreboard_cache_timeout` >= 0),
  `data_last_downloaded` datetime(6) DEFAULT NULL,
  `disallow_virtual` tinyint(1) NOT NULL,
  `ranking_access_code` varchar(255) NOT NULL,
  `registration_end` datetime(6) DEFAULT NULL,
  `registration_start` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `judge_contest_name_23b5c29c` (`name`),
  KEY `judge_contest_start_time_8dd80870` (`start_time`),
  KEY `judge_contest_end_time_f0179778` (`end_time`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest` WRITE;
/*!40000 ALTER TABLE `judge_contest` DISABLE KEYS */;
INSERT INTO `judge_contest` VALUES
(1,'c1','C1','','2026-10-02 03:12:12.404599','2026-10-02 04:12:12.404604',NULL,0,0,1,0,0,0,0,'','',0,'','','default','{bad',NULL,NULL,0,'',3,'V',0,NULL,0,'',0,0,0,0,0,NULL,0,'',NULL,NULL);
/*!40000 ALTER TABLE `judge_contest` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_authors` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_organizers_contest_id_profile_id_35f37708_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_organizers_profile_id_fe54f029_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_contest_organizers_contest_id_266a7461_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_organizers_profile_id_fe54f029_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_authors` WRITE;
/*!40000 ALTER TABLE `judge_contest_authors` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_authors` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_banned_judges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_banned_judges` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `judge_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_banned_judges_contest_id_judge_id_25704a78_uniq` (`contest_id`,`judge_id`),
  KEY `judge_contest_banned_judges_judge_id_27dd8be2_fk_judge_judge_id` (`judge_id`),
  CONSTRAINT `judge_contest_banned_contest_id_9dda648c_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_banned_judges_judge_id_27dd8be2_fk_judge_judge_id` FOREIGN KEY (`judge_id`) REFERENCES `judge_judge` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_banned_judges` WRITE;
/*!40000 ALTER TABLE `judge_contest_banned_judges` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_banned_judges` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_banned_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_banned_users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_banned_users_contest_id_profile_id_b0570b33_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_banned_profile_id_ae615b59_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_contest_banned_contest_id_14d2192a_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_banned_profile_id_ae615b59_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_banned_users` WRITE;
/*!40000 ALTER TABLE `judge_contest_banned_users` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_banned_users` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_curators`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_curators` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_curators_contest_id_profile_id_6bcc5bc0_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_curators_profile_id_73c4ada2_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_contest_curators_contest_id_06a850b7_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_curators_profile_id_73c4ada2_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_curators` WRITE;
/*!40000 ALTER TABLE `judge_contest_curators` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_curators` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_organizations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `organization_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_organizati_contest_id_organization__f8aafa91_uniq` (`contest_id`,`organization_id`),
  KEY `judge_contest_organi_organization_id_6ccef0d9_fk_judge_org` (`organization_id`),
  CONSTRAINT `judge_contest_organi_contest_id_8b6686ce_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_organi_organization_id_6ccef0d9_fk_judge_org` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_organizations` WRITE;
/*!40000 ALTER TABLE `judge_contest_organizations` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_organizations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_private_contestants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_private_contestants` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_private_co_contest_id_profile_id_ef23dc8d_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_privat_profile_id_34a11bc5_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_contest_privat_contest_id_a30921fe_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_privat_profile_id_34a11bc5_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_private_contestants` WRITE;
/*!40000 ALTER TABLE `judge_contest_private_contestants` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_private_contestants` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_rate_exclude`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_rate_exclude` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_rate_exclude_contest_id_profile_id_2b34d7a9_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_rate_e_profile_id_6c9400fa_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_contest_rate_e_contest_id_30174232_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_rate_e_profile_id_6c9400fa_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_rate_exclude` WRITE;
/*!40000 ALTER TABLE `judge_contest_rate_exclude` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_rate_exclude` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_tags` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `contesttag_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_tags_contest_id_contesttag_id_eedb695b_uniq` (`contest_id`,`contesttag_id`),
  KEY `judge_contest_tags_contesttag_id_5d9788bd_fk_judge_contesttag_id` (`contesttag_id`),
  CONSTRAINT `judge_contest_tags_contest_id_998f99f7_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_tags_contesttag_id_5d9788bd_fk_judge_contesttag_id` FOREIGN KEY (`contesttag_id`) REFERENCES `judge_contesttag` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_tags` WRITE;
/*!40000 ALTER TABLE `judge_contest_tags` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_tags` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_testers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_testers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_testers_contest_id_profile_id_52e96be5_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_testers_profile_id_d62d1c9b_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_contest_testers_contest_id_6122faf2_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_testers_profile_id_d62d1c9b_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_testers` WRITE;
/*!40000 ALTER TABLE `judge_contest_testers` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_testers` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contest_view_contest_scoreboard`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contest_view_contest_scoreboard` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contest_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contest_view_conte_contest_id_profile_id_5fbd08d1_uniq` (`contest_id`,`profile_id`),
  KEY `judge_contest_view_c_profile_id_60bb0f4a_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_contest_view_c_contest_id_30aa03fe_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contest_view_c_profile_id_60bb0f4a_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contest_view_contest_scoreboard` WRITE;
/*!40000 ALTER TABLE `judge_contest_view_contest_scoreboard` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contest_view_contest_scoreboard` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestannouncement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestannouncement` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(100) NOT NULL,
  `description` longtext NOT NULL,
  `date` datetime(6) NOT NULL,
  `contest_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_contestannounc_contest_id_164cfbee_fk_judge_con` (`contest_id`),
  CONSTRAINT `judge_contestannounc_contest_id_164cfbee_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestannouncement` WRITE;
/*!40000 ALTER TABLE `judge_contestannouncement` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestannouncement` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestmoss`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestmoss` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `language` varchar(10) NOT NULL,
  `submission_count` int(10) unsigned NOT NULL CHECK (`submission_count` >= 0),
  `url` varchar(200) DEFAULT NULL,
  `contest_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contestmoss_contest_id_problem_id_language_52b59ba8_uniq` (`contest_id`,`problem_id`,`language`),
  KEY `judge_contestmoss_problem_id_5d8c1e4e_fk_judge_problem_id` (`problem_id`),
  CONSTRAINT `judge_contestmoss_contest_id_24908198_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contestmoss_problem_id_5d8c1e4e_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestmoss` WRITE;
/*!40000 ALTER TABLE `judge_contestmoss` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestmoss` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestparticipation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestparticipation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `start` datetime(6) NOT NULL,
  `score` double NOT NULL,
  `cumtime` int(10) unsigned NOT NULL CHECK (`cumtime` >= 0),
  `virtual` int(11) NOT NULL,
  `format_data` longtext DEFAULT NULL,
  `contest_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `is_disqualified` tinyint(1) NOT NULL,
  `tiebreaker` double NOT NULL,
  `frozen_cumtime` int(10) unsigned NOT NULL CHECK (`frozen_cumtime` >= 0),
  `frozen_score` double NOT NULL,
  `frozen_tiebreaker` double NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contestparticipati_contest_id_user_id_virtu_dc257b0c_uniq` (`contest_id`,`user_id`,`virtual`),
  KEY `judge_contestparticipation_user_id_5896ee2e_fk_judge_profile_id` (`user_id`),
  KEY `judge_contestparticipation_score_4098b84f` (`score`),
  KEY `judge_contestparticipation_frozen_score_caac9939` (`frozen_score`),
  CONSTRAINT `judge_contestpartici_contest_id_ab097823_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contestparticipation_user_id_5896ee2e_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestparticipation` WRITE;
/*!40000 ALTER TABLE `judge_contestparticipation` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestparticipation` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestproblem`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestproblem` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `points` int(11) NOT NULL,
  `partial` tinyint(1) NOT NULL,
  `is_pretested` tinyint(1) NOT NULL,
  `order` int(10) unsigned NOT NULL CHECK (`order` >= 0),
  `output_prefix_override` int(11) DEFAULT NULL,
  `max_submissions` int(11) DEFAULT NULL,
  `contest_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_contestproblem_problem_id_contest_id_4ae77fe0_uniq` (`problem_id`,`contest_id`),
  KEY `judge_contestproblem_contest_id_b28b7107_fk_judge_contest_id` (`contest_id`),
  KEY `judge_contestproblem_order_05ce0638` (`order`),
  CONSTRAINT `judge_contestproblem_contest_id_b28b7107_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_contestproblem_problem_id_fc63c700_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestproblem` WRITE;
/*!40000 ALTER TABLE `judge_contestproblem` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestproblem` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestpublicrankinglink`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestpublicrankinglink` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(18) NOT NULL,
  `status` varchar(8) NOT NULL,
  `expiry_mode` varchar(1) NOT NULL,
  `expiry_amount` int(10) unsigned DEFAULT NULL CHECK (`expiry_amount` >= 0),
  `expires_at` datetime(6) DEFAULT NULL,
  `regenerated_at` datetime(6) NOT NULL,
  `contest_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  UNIQUE KEY `contest_id` (`contest_id`),
  CONSTRAINT `judge_contestpublicr_contest_id_eff76abb_fk_judge_con` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestpublicrankinglink` WRITE;
/*!40000 ALTER TABLE `judge_contestpublicrankinglink` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestpublicrankinglink` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contestsubmission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contestsubmission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `points` double NOT NULL,
  `is_pretest` tinyint(1) NOT NULL,
  `participation_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  `submission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `submission_id` (`submission_id`),
  KEY `judge_contestsubmiss_participation_id_cf83bbb0_fk_judge_con` (`participation_id`),
  KEY `judge_contestsubmiss_problem_id_1b1240d4_fk_judge_con` (`problem_id`),
  CONSTRAINT `judge_contestsubmiss_participation_id_cf83bbb0_fk_judge_con` FOREIGN KEY (`participation_id`) REFERENCES `judge_contestparticipation` (`id`),
  CONSTRAINT `judge_contestsubmiss_problem_id_1b1240d4_fk_judge_con` FOREIGN KEY (`problem_id`) REFERENCES `judge_contestproblem` (`id`),
  CONSTRAINT `judge_contestsubmiss_submission_id_1384e5aa_fk_judge_sub` FOREIGN KEY (`submission_id`) REFERENCES `judge_submission` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contestsubmission` WRITE;
/*!40000 ALTER TABLE `judge_contestsubmission` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contestsubmission` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_contesttag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_contesttag` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `color` varchar(7) NOT NULL,
  `description` longtext NOT NULL,
  `full_name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_contesttag` WRITE;
/*!40000 ALTER TABLE `judge_contesttag` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_contesttag` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_externaljudgeconfig`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_externaljudgeconfig` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `base_url` varchar(200) NOT NULL,
  `encrypted_api_token` longtext NOT NULL,
  `token_prefix` varchar(20) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `timeout_seconds` int(10) unsigned NOT NULL CHECK (`timeout_seconds` >= 0),
  `poll_timeout_seconds` int(10) unsigned NOT NULL CHECK (`poll_timeout_seconds` >= 0),
  `poll_interval_seconds` int(10) unsigned NOT NULL CHECK (`poll_interval_seconds` >= 0),
  `max_poll_attempts` int(10) unsigned NOT NULL CHECK (`max_poll_attempts` >= 0),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `last_verified_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_externaljudgeconfig` WRITE;
/*!40000 ALTER TABLE `judge_externaljudgeconfig` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_externaljudgeconfig` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_externalproblem`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_externalproblem` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `oj` varchar(50) NOT NULL,
  `external_problem_id` varchar(100) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `metadata_cache` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`metadata_cache`)),
  `language_mappings` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`language_mappings`)),
  `last_synced_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `config_id` bigint(20) DEFAULT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `problem_id` (`problem_id`),
  KEY `judge_exter_config__de795d_idx` (`config_id`,`oj`,`external_problem_id`),
  CONSTRAINT `judge_externalproble_config_id_8fb58b87_fk_judge_ext` FOREIGN KEY (`config_id`) REFERENCES `judge_externaljudgeconfig` (`id`),
  CONSTRAINT `judge_externalproblem_problem_id_4272e9ec_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_externalproblem` WRITE;
/*!40000 ALTER TABLE `judge_externalproblem` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_externalproblem` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_externalsubmission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_externalsubmission` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `pcd_submission_id` uuid NOT NULL,
  `pcd_system_status` varchar(30) NOT NULL,
  `pcd_status_canonical` varchar(30) DEFAULT NULL,
  `pcd_vjudge_run_id` varchar(100) DEFAULT NULL,
  `pcd_remote_url` varchar(1000) DEFAULT NULL,
  `pcd_runtime_ms` int(11) DEFAULT NULL,
  `pcd_memory_kb` int(11) DEFAULT NULL,
  `pcd_score_text` varchar(100) DEFAULT NULL,
  `last_polled_at` datetime(6) DEFAULT NULL,
  `poll_attempts` int(10) unsigned NOT NULL CHECK (`poll_attempts` >= 0),
  `raw_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`raw_response`)),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `config_id` bigint(20) DEFAULT NULL,
  `submission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `submission_id` (`submission_id`),
  KEY `judge_externalsubmis_config_id_e516ff1e_fk_judge_ext` (`config_id`),
  CONSTRAINT `judge_externalsubmis_config_id_e516ff1e_fk_judge_ext` FOREIGN KEY (`config_id`) REFERENCES `judge_externaljudgeconfig` (`id`),
  CONSTRAINT `judge_externalsubmis_submission_id_f2bcf720_fk_judge_sub` FOREIGN KEY (`submission_id`) REFERENCES `judge_submission` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_externalsubmission` WRITE;
/*!40000 ALTER TABLE `judge_externalsubmission` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_externalsubmission` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_generalissue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_generalissue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `issue_url` varchar(200) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_generalissue` WRITE;
/*!40000 ALTER TABLE `judge_generalissue` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_generalissue` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_judge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_judge` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `created` datetime(6) NOT NULL,
  `auth_key` varchar(100) NOT NULL,
  `is_blocked` tinyint(1) NOT NULL,
  `online` tinyint(1) NOT NULL,
  `start_time` datetime(6) DEFAULT NULL,
  `ping` double DEFAULT NULL,
  `load` double DEFAULT NULL,
  `description` longtext NOT NULL,
  `last_ip` char(39) DEFAULT NULL,
  `is_disabled` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_judge` WRITE;
/*!40000 ALTER TABLE `judge_judge` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_judge` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_judge_problems`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_judge_problems` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `judge_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_judge_problems_judge_id_problem_id_7cc4b18b_uniq` (`judge_id`,`problem_id`),
  KEY `judge_judge_problems_problem_id_fa0f569c_fk_judge_problem_id` (`problem_id`),
  CONSTRAINT `judge_judge_problems_judge_id_e0c28fa3_fk_judge_judge_id` FOREIGN KEY (`judge_id`) REFERENCES `judge_judge` (`id`),
  CONSTRAINT `judge_judge_problems_problem_id_fa0f569c_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_judge_problems` WRITE;
/*!40000 ALTER TABLE `judge_judge_problems` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_judge_problems` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_judge_runtimes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_judge_runtimes` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `judge_id` int(11) NOT NULL,
  `language_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_judge_runtimes_judge_id_language_id_ececbd6e_uniq` (`judge_id`,`language_id`),
  KEY `judge_judge_runtimes_language_id_9575fc7b_fk_judge_language_id` (`language_id`),
  CONSTRAINT `judge_judge_runtimes_judge_id_770ad6a5_fk_judge_judge_id` FOREIGN KEY (`judge_id`) REFERENCES `judge_judge` (`id`),
  CONSTRAINT `judge_judge_runtimes_language_id_9575fc7b_fk_judge_language_id` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_judge_runtimes` WRITE;
/*!40000 ALTER TABLE `judge_judge_runtimes` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_judge_runtimes` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_language`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_language` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(10) NOT NULL,
  `name` varchar(20) NOT NULL,
  `short_name` varchar(10) DEFAULT NULL,
  `common_name` varchar(20) NOT NULL,
  `ace` varchar(20) NOT NULL,
  `pygments` varchar(20) NOT NULL,
  `template` longtext NOT NULL,
  `info` varchar(50) NOT NULL,
  `description` longtext NOT NULL,
  `extension` varchar(10) NOT NULL,
  `file_only` tinyint(1) NOT NULL,
  `file_size_limit` int(11) NOT NULL,
  `include_in_problem` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_language` WRITE;
/*!40000 ALTER TABLE `judge_language` DISABLE KEYS */;
INSERT INTO `judge_language` VALUES
(1,'CPP03','C++03','C++03','C++','c_cpp','cpp','#include <bits/stdc++.h>\r\n\r\nusing namespace std;\r\n\r\nint main() {\r\n    ios_base::sync_with_stdio(false);\r\n    cin.tie(NULL);\r\n    \r\n    return 0;\r\n}','','Compile options: `g++ -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','cpp',0,0,1),
(2,'CPP11','C++11','C++11','C++','c_cpp','cpp','#include <bits/stdc++.h>\r\n\r\nusing namespace std;\r\n\r\nint main() {\r\n    ios_base::sync_with_stdio(false);\r\n    cin.tie(NULL);\r\n    \r\n    return 0;\r\n}','','Compile options: `g++ -std=c++11 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','cpp',0,0,1),
(3,'CPP14','C++14','C++14','C++','c_cpp','cpp','#include <bits/stdc++.h>\r\n\r\nusing namespace std;\r\n\r\nint main() {\r\n    ios_base::sync_with_stdio(false);\r\n    cin.tie(NULL);\r\n    \r\n    return 0;\r\n}','','Compile options: `g++ -std=c++14 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','cpp',0,0,1),
(4,'CPP17','C++17','C++17','C++','c_cpp','cpp','#include <bits/stdc++.h>\r\n\r\nusing namespace std;\r\n\r\nint main() {\r\n    ios_base::sync_with_stdio(false);\r\n    cin.tie(NULL);\r\n    \r\n    return 0;\r\n}','','Compile options: `g++ -std=c++17 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','cpp',0,0,1),
(5,'C','C',NULL,'C','c_cpp','c','#include <stdio.h>\r\n\r\nint main() {\r\n    return 0;\r\n}','','Compile options: `gcc -std=c99 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','c',0,0,1),
(6,'C11','C11',NULL,'C','c_cpp','cpp','#include <stdio.h>\r\n\r\nint main() {\r\n    return 0;\r\n}','','Compile options: `gcc -std=c11 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','c',0,0,1),
(7,'PAS','Pascal',NULL,'Pascal','pascal','pascal','','','Compile options: `fpc -Fe/dev/stderr -O2`','pas',0,0,1),
(8,'PY2','Python 2',NULL,'Python','python','python','','','Compile options: `python -m compileall -q`','py',0,0,1),
(9,'PY3','Python 3',NULL,'Python','python','python3','','','Compile options: `python3 -m compileall -q`','py',0,0,1),
(10,'JAVA8','Java 8',NULL,'Java','java','java','import java.io.*;\r\nimport java.util.*;\r\n\r\npublic class Main {\r\n    public static void main(String[] args) {\r\n\r\n    }\r\n}','','Compile options: `javac8 -encoding UTF-8 -profile compact1`','java',0,0,1),
(11,'TEXT','TEXT','TEXT','TEXT','text','text','','','Run options: `cat`','txt',0,0,0),
(12,'SCRATCH','Scratch',NULL,'Scratch','text','text','','','Check options: `scratch-run --check`','sb3',1,1,1),
(13,'OUTPUT','Output Only',NULL,'Output Only','text','text','','','','zip',1,10,0),
(14,'CPP20','C++20','C++20','C++','c_cpp','cpp','#include <bits/stdc++.h>\r\n\r\nusing namespace std;\r\n\r\nint main() {\r\n    ios_base::sync_with_stdio(false);\r\n    cin.tie(NULL);\r\n    \r\n    return 0;\r\n}','','Compile options: `g++ -std=c++20 -Wall -DONLINE_JUDGE -O2 -lm -fmax-errors=5 -march=native -s`','cpp',0,0,1),
(15,'KOTLIN','Kotlin',NULL,'Kotlin','kotlin','kotlin','','','Compile options: `kotlinc -include-runtime`','kt',0,0,1),
(16,'PYPY','PyPy 2','PYPY2','PyPy','python','python','','','Compile options: `pypy -m compileall -q`','py',0,0,1),
(17,'PYPY3','PyPy 3',NULL,'PyPy','python','python','','','Compile options: `pypy3 -m compileall -q`','py',0,0,1),
(18,'JAVA','Java 19',NULL,'Java','java','java','import java.io.*;\r\nimport java.util.*;\r\n\r\npublic class Main {\r\n    public static void main(String[] args) {\r\n\r\n    }\r\n}','','Compile options: `javac19 -encoding UTF-8`','java',0,0,1);
/*!40000 ALTER TABLE `judge_language` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_languagelimit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_languagelimit` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `time_limit` double NOT NULL,
  `memory_limit` int(11) NOT NULL,
  `language_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_languagelimit_problem_id_language_id_fbd3d3fc_uniq` (`problem_id`,`language_id`),
  KEY `judge_languagelimit_language_id_b81fe043_fk_judge_language_id` (`language_id`),
  CONSTRAINT `judge_languagelimit_language_id_b81fe043_fk_judge_language_id` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`),
  CONSTRAINT `judge_languagelimit_problem_id_bb544679_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_languagelimit` WRITE;
/*!40000 ALTER TABLE `judge_languagelimit` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_languagelimit` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_license`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_license` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(20) NOT NULL,
  `link` varchar(256) NOT NULL,
  `name` varchar(256) NOT NULL,
  `display` varchar(256) NOT NULL,
  `icon` varchar(256) NOT NULL,
  `text` longtext NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_license` WRITE;
/*!40000 ALTER TABLE `judge_license` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_license` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_miscconfig`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_miscconfig` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(30) NOT NULL,
  `value` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_miscconfig_key_bb230360` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_miscconfig` WRITE;
/*!40000 ALTER TABLE `judge_miscconfig` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_miscconfig` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_navigationbar`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_navigationbar` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order` int(10) unsigned NOT NULL CHECK (`order` >= 0),
  `key` varchar(10) NOT NULL,
  `label` varchar(20) NOT NULL,
  `path` varchar(255) NOT NULL,
  `regex` longtext NOT NULL,
  `lft` int(10) unsigned NOT NULL CHECK (`lft` >= 0),
  `rght` int(10) unsigned NOT NULL CHECK (`rght` >= 0),
  `tree_id` int(10) unsigned NOT NULL CHECK (`tree_id` >= 0),
  `level` int(10) unsigned NOT NULL CHECK (`level` >= 0),
  `parent_id` int(11) DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `judge_navigationbar_order_48c84306` (`order`),
  KEY `judge_navigationbar_tree_id_e12b3b53` (`tree_id`),
  KEY `judge_navigationbar_parent_id_806f64e3` (`parent_id`),
  CONSTRAINT `judge_navigationbar_parent_id_806f64e3_fk_judge_navigationbar_id` FOREIGN KEY (`parent_id`) REFERENCES `judge_navigationbar` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_navigationbar` WRITE;
/*!40000 ALTER TABLE `judge_navigationbar` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_navigationbar` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_organization`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_organization` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `short_name` varchar(20) NOT NULL,
  `about` longtext NOT NULL,
  `creation_date` datetime(6) NOT NULL,
  `is_open` tinyint(1) NOT NULL,
  `slots` int(11) DEFAULT NULL,
  `access_code` varchar(7) DEFAULT NULL,
  `logo_override_image` varchar(150) NOT NULL,
  `performance_points` double NOT NULL,
  `member_count` int(11) NOT NULL,
  `is_unlisted` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_organization_slug_5e7161c5_uniq` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_organization` WRITE;
/*!40000 ALTER TABLE `judge_organization` DISABLE KEYS */;
INSERT INTO `judge_organization` VALUES
(1,'Org A','org-a','A','','2026-10-02 03:12:11.853886',0,NULL,NULL,'',0,1,1),
(2,'Org B','org-b','B','','2026-10-02 03:12:11.854890',0,NULL,NULL,'',0,1,1);
/*!40000 ALTER TABLE `judge_organization` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_organization_admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_organization_admins` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `organization_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_organization_admin_organization_id_profile__7528cebe_uniq` (`organization_id`,`profile_id`),
  KEY `judge_organization_a_profile_id_b5559f11_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_organization_a_organization_id_b2125a57_fk_judge_org` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`),
  CONSTRAINT `judge_organization_a_profile_id_b5559f11_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_organization_admins` WRITE;
/*!40000 ALTER TABLE `judge_organization_admins` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_organization_admins` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_organizationrequest`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_organizationrequest` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `time` datetime(6) NOT NULL,
  `state` varchar(1) NOT NULL,
  `reason` longtext NOT NULL,
  `organization_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_organizationrequest_user_id_b721da81_fk_judge_profile_id` (`user_id`),
  KEY `judge_organizationre_organization_id_e2ab3e9a_fk_judge_org` (`organization_id`),
  CONSTRAINT `judge_organizationre_organization_id_e2ab3e9a_fk_judge_org` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`),
  CONSTRAINT `judge_organizationrequest_user_id_b721da81_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_organizationrequest` WRITE;
/*!40000 ALTER TABLE `judge_organizationrequest` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_organizationrequest` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` longtext NOT NULL,
  `time_limit` double NOT NULL,
  `memory_limit` int(10) unsigned NOT NULL,
  `short_circuit` tinyint(1) NOT NULL,
  `points` int(11) NOT NULL,
  `partial` tinyint(1) NOT NULL,
  `is_public` tinyint(1) NOT NULL,
  `is_manually_managed` tinyint(1) NOT NULL,
  `date` datetime(6) DEFAULT NULL,
  `og_image` varchar(150) NOT NULL,
  `summary` longtext NOT NULL,
  `user_count` int(11) NOT NULL,
  `ac_rate` double NOT NULL,
  `is_organization_private` tinyint(1) NOT NULL,
  `group_id` int(11) NOT NULL,
  `license_id` int(11) DEFAULT NULL,
  `is_full_markup` tinyint(1) NOT NULL,
  `pdf_url` varchar(200) NOT NULL,
  `source` varchar(200) NOT NULL,
  `suggester_id` int(11) DEFAULT NULL,
  `submission_source_visibility_mode` varchar(1) NOT NULL,
  `testcase_visibility_mode` varchar(1) NOT NULL,
  `allow_view_feedback` tinyint(1) NOT NULL,
  `testcase_result_visibility_mode` varchar(1) NOT NULL,
  `problem_material` varchar(200) NOT NULL,
  `mirror_of_id` int(11) DEFAULT NULL,
  `mirror_root_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `judge_problem_group_id_1b7ca650_fk_judge_problemgroup_id` (`group_id`),
  KEY `judge_problem_license_id_32ca8b1a_fk_judge_license_id` (`license_id`),
  KEY `judge_problem_name_c48e19b2` (`name`),
  KEY `judge_problem_is_public_c5da02a8` (`is_public`),
  KEY `judge_problem_is_manually_managed_56d3b634` (`is_manually_managed`),
  KEY `judge_problem_date_f1f729a4` (`date`),
  KEY `judge_problem_source_8a196bf6` (`source`),
  KEY `judge_problem_suggester_id_3f45cefa_fk_judge_profile_id` (`suggester_id`),
  KEY `judge_problem_mirror_of_id_ce1eba52_fk_judge_problem_id` (`mirror_of_id`),
  KEY `judge_problem_mirror_root_id_1b633f35_fk_judge_problem_id` (`mirror_root_id`),
  CONSTRAINT `judge_problem_group_id_1b7ca650_fk_judge_problemgroup_id` FOREIGN KEY (`group_id`) REFERENCES `judge_problemgroup` (`id`),
  CONSTRAINT `judge_problem_license_id_32ca8b1a_fk_judge_license_id` FOREIGN KEY (`license_id`) REFERENCES `judge_license` (`id`),
  CONSTRAINT `judge_problem_mirror_of_id_ce1eba52_fk_judge_problem_id` FOREIGN KEY (`mirror_of_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_mirror_root_id_1b633f35_fk_judge_problem_id` FOREIGN KEY (`mirror_root_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_suggester_id_3f45cefa_fk_judge_profile_id` FOREIGN KEY (`suggester_id`) REFERENCES `judge_profile` (`id`),
  CONSTRAINT `judge_problem_memory_limit_a129f739_check` CHECK (`memory_limit` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem` WRITE;
/*!40000 ALTER TABLE `judge_problem` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_allowed_languages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_allowed_languages` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `language_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_allowed_la_problem_id_language_id_f6265ceb_uniq` (`problem_id`,`language_id`),
  KEY `judge_problem_allowe_language_id_67ad291b_fk_judge_lan` (`language_id`),
  CONSTRAINT `judge_problem_allowe_language_id_67ad291b_fk_judge_lan` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`),
  CONSTRAINT `judge_problem_allowe_problem_id_1020494d_fk_judge_pro` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_allowed_languages` WRITE;
/*!40000 ALTER TABLE `judge_problem_allowed_languages` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_allowed_languages` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_authors` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_authors_problem_id_profile_id_4c5741b5_uniq` (`problem_id`,`profile_id`),
  KEY `judge_problem_authors_profile_id_e9577295_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_problem_authors_problem_id_e7c69267_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_authors_profile_id_e9577295_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_authors` WRITE;
/*!40000 ALTER TABLE `judge_problem_authors` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_authors` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_banned_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_banned_users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_banned_users_problem_id_profile_id_068a01f9_uniq` (`problem_id`,`profile_id`),
  KEY `judge_problem_banned_profile_id_4dcfff77_fk_judge_pro` (`profile_id`),
  CONSTRAINT `judge_problem_banned_problem_id_f5f73ac2_fk_judge_pro` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_banned_profile_id_4dcfff77_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_banned_users` WRITE;
/*!40000 ALTER TABLE `judge_problem_banned_users` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_banned_users` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_curators`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_curators` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_curators_problem_id_profile_id_daffe335_uniq` (`problem_id`,`profile_id`),
  KEY `judge_problem_curators_profile_id_46e87efb_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_problem_curators_problem_id_6babca8c_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_curators_profile_id_46e87efb_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_curators` WRITE;
/*!40000 ALTER TABLE `judge_problem_curators` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_curators` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_organizations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `organization_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_organizati_problem_id_organization__2745924c_uniq` (`problem_id`,`organization_id`),
  KEY `judge_problem_organi_organization_id_0eb88735_fk_judge_org` (`organization_id`),
  CONSTRAINT `judge_problem_organi_organization_id_0eb88735_fk_judge_org` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`),
  CONSTRAINT `judge_problem_organi_problem_id_d3edc28b_fk_judge_pro` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_organizations` WRITE;
/*!40000 ALTER TABLE `judge_problem_organizations` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_organizations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_testers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_testers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_testers_problem_id_profile_id_3ff28b2a_uniq` (`problem_id`,`profile_id`),
  KEY `judge_problem_testers_profile_id_dadcfbad_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_problem_testers_problem_id_0796300b_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_testers_profile_id_dadcfbad_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_testers` WRITE;
/*!40000 ALTER TABLE `judge_problem_testers` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_testers` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problem_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problem_types` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `problem_id` int(11) NOT NULL,
  `problemtype_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problem_types_problem_id_problemtype_id_db67c44c_uniq` (`problem_id`,`problemtype_id`),
  KEY `judge_problem_types_problemtype_id_f51f1eea_fk_judge_pro` (`problemtype_id`),
  CONSTRAINT `judge_problem_types_problem_id_1c63e65f_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_problem_types_problemtype_id_f51f1eea_fk_judge_pro` FOREIGN KEY (`problemtype_id`) REFERENCES `judge_problemtype` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problem_types` WRITE;
/*!40000 ALTER TABLE `judge_problem_types` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problem_types` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemclarification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemclarification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `description` longtext NOT NULL,
  `date` datetime(6) NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_problemclarifi_problem_id_3d9eb049_fk_judge_pro` (`problem_id`),
  CONSTRAINT `judge_problemclarifi_problem_id_3d9eb049_fk_judge_pro` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemclarification` WRITE;
/*!40000 ALTER TABLE `judge_problemclarification` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemclarification` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemdata`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemdata` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zipfile` varchar(100) DEFAULT NULL,
  `generator` varchar(100) DEFAULT NULL,
  `output_prefix` int(11) DEFAULT NULL,
  `output_limit` int(11) DEFAULT NULL,
  `feedback` longtext NOT NULL,
  `checker` varchar(10) NOT NULL,
  `checker_args` longtext NOT NULL,
  `problem_id` int(11) NOT NULL,
  `custom_checker` varchar(100) DEFAULT NULL,
  `custom_grader` varchar(100) DEFAULT NULL,
  `custom_header` varchar(100) DEFAULT NULL,
  `grader` varchar(30) NOT NULL,
  `grader_args` longtext NOT NULL,
  `nobigmath` tinyint(1) DEFAULT NULL,
  `unicode` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `problem_id` (`problem_id`),
  CONSTRAINT `judge_problemdata_problem_id_d825e6f8_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemdata` WRITE;
/*!40000 ALTER TABLE `judge_problemdata` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemdata` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemgroup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemgroup` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `full_name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemgroup` WRITE;
/*!40000 ALTER TABLE `judge_problemgroup` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemgroup` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemtestcase`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemtestcase` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order` int(11) NOT NULL,
  `type` varchar(1) NOT NULL,
  `input_file` varchar(100) NOT NULL,
  `output_file` varchar(100) NOT NULL,
  `generator_args` longtext NOT NULL,
  `points` int(11) DEFAULT NULL,
  `is_pretest` tinyint(1) NOT NULL,
  `output_prefix` int(11) DEFAULT NULL,
  `output_limit` int(11) DEFAULT NULL,
  `checker` varchar(10) NOT NULL,
  `checker_args` longtext NOT NULL,
  `dataset_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_problemtestcase_dataset_id_964229fd_fk_judge_problem_id` (`dataset_id`),
  CONSTRAINT `judge_problemtestcase_dataset_id_964229fd_fk_judge_problem_id` FOREIGN KEY (`dataset_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemtestcase` WRITE;
/*!40000 ALTER TABLE `judge_problemtestcase` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemtestcase` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemtranslation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemtranslation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `language` varchar(7) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` longtext NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_problemtranslation_problem_id_language_ed6ab873_uniq` (`problem_id`,`language`),
  KEY `judge_problemtranslation_name_3bfcdd8c` (`name`),
  CONSTRAINT `judge_problemtranslation_problem_id_7acb27a7_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemtranslation` WRITE;
/*!40000 ALTER TABLE `judge_problemtranslation` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemtranslation` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_problemtype`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_problemtype` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `full_name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_problemtype` WRITE;
/*!40000 ALTER TABLE `judge_problemtype` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_problemtype` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_profile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `about` longtext DEFAULT NULL,
  `timezone` varchar(50) NOT NULL,
  `points` double NOT NULL,
  `performance_points` double NOT NULL,
  `problem_count` int(11) NOT NULL,
  `ace_theme` varchar(30) NOT NULL,
  `last_access` datetime(6) NOT NULL,
  `ip` char(39) DEFAULT NULL,
  `display_rank` varchar(10) NOT NULL,
  `mute` tinyint(1) NOT NULL,
  `is_unlisted` tinyint(1) NOT NULL,
  `rating` int(11) DEFAULT NULL,
  `user_script` longtext NOT NULL,
  `math_engine` varchar(4) NOT NULL,
  `is_totp_enabled` tinyint(1) NOT NULL,
  `totp_key` longblob DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `current_contest_id` int(11) DEFAULT NULL,
  `language_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `api_token` varchar(64) DEFAULT NULL,
  `is_webauthn_enabled` tinyint(1) NOT NULL,
  `data_last_downloaded` datetime(6) DEFAULT NULL,
  `scratch_codes` longblob DEFAULT NULL,
  `contribution_points` int(11) NOT NULL,
  `allow_tagging` tinyint(1) NOT NULL,
  `last_totp_timecode` int(11) NOT NULL,
  `ban_reason` longtext DEFAULT NULL,
  `username_display_override` varchar(100) NOT NULL,
  `display_badge_id` int(11) DEFAULT NULL,
  `site_theme` varchar(10) NOT NULL,
  `ip_auth` char(39) DEFAULT NULL,
  `vnoj_points` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `current_contest_id` (`current_contest_id`),
  UNIQUE KEY `ip_auth` (`ip_auth`),
  KEY `judge_profile_language_id_87d3cab1_fk_judge_language_id` (`language_id`),
  KEY `judge_profile_display_badge_id_dc30ad34_fk_judge_badge_id` (`display_badge_id`),
  KEY `judge_profi_is_unli_1410d8_idx` (`is_unlisted`,`performance_points` DESC),
  KEY `judge_profi_is_unli_d31e5b_idx` (`is_unlisted`,`contribution_points` DESC),
  KEY `judge_profi_is_unli_bcf16a_idx` (`is_unlisted`,`rating` DESC),
  KEY `judge_profi_is_unli_171bf3_idx` (`is_unlisted`,`problem_count` DESC),
  CONSTRAINT `judge_profile_current_contest_id_ca595142_fk_judge_con` FOREIGN KEY (`current_contest_id`) REFERENCES `judge_contestparticipation` (`id`),
  CONSTRAINT `judge_profile_display_badge_id_dc30ad34_fk_judge_badge_id` FOREIGN KEY (`display_badge_id`) REFERENCES `judge_badge` (`id`),
  CONSTRAINT `judge_profile_language_id_87d3cab1_fk_judge_language_id` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`),
  CONSTRAINT `judge_profile_user_id_b62d6977_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_profile` WRITE;
/*!40000 ALTER TABLE `judge_profile` DISABLE KEYS */;
INSERT INTO `judge_profile` VALUES
(1,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:11.850811',NULL,'user',0,0,NULL,'','auto',1,'gAAAAABqvyELENajrdldpjfnAzR6uhIrYbEtQCp_18SfiPqCIymRFNhvnj3qeVmUxbjqLxPkTOZdP1_e-dWtBmcE5KuRm6EIr9ITul-a4R9BZ0NiCWAKO633fJQjZM06zkrcunJtTiun',NULL,NULL,4,1,NULL,0,NULL,'gAAAAABqvyEL4gny4D0dxTQdIXd1ynSk7tzP39N2ollE84SDWczheyX-2A2tGSKzK_cpIScxyAsfVx5XRhxRmu-eqyPwACkAWXPk6csJr6ST_KlmG5kdovo=',0,1,0,NULL,'',NULL,'light',NULL,0),
(2,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:11.997238',NULL,'user',0,0,NULL,'','auto',0,NULL,NULL,NULL,4,2,NULL,0,NULL,NULL,0,1,0,NULL,'',NULL,'light',NULL,0),
(3,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:12.132749',NULL,'user',0,0,NULL,'','auto',0,NULL,NULL,NULL,4,3,NULL,0,NULL,NULL,0,1,0,NULL,'',NULL,'light',NULL,0),
(4,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:12.266811',NULL,'user',0,0,NULL,'','auto',0,NULL,NULL,NULL,4,4,NULL,0,'0000-00-00 00:00:00.000000',NULL,0,1,0,'spam','',NULL,'light',NULL,0),
(5,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:12.270909',NULL,'user',0,0,NULL,'','auto',0,NULL,NULL,NULL,4,5,NULL,0,NULL,NULL,0,1,0,NULL,'',NULL,'light',NULL,0),
(6,NULL,'America/Toronto',0,0,0,'auto','2026-10-02 03:12:13.285865',NULL,'user',0,0,NULL,'','auto',0,NULL,NULL,NULL,4,6,NULL,0,NULL,NULL,0,1,0,NULL,'',NULL,'light',NULL,0);
/*!40000 ALTER TABLE `judge_profile` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_profile_badges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_profile_badges` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `badge_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_profile_badges_profile_id_badge_id_5e1e5072_uniq` (`profile_id`,`badge_id`),
  KEY `judge_profile_badges_badge_id_ec2e6035_fk_judge_badge_id` (`badge_id`),
  CONSTRAINT `judge_profile_badges_badge_id_ec2e6035_fk_judge_badge_id` FOREIGN KEY (`badge_id`) REFERENCES `judge_badge` (`id`),
  CONSTRAINT `judge_profile_badges_profile_id_be0cef45_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_profile_badges` WRITE;
/*!40000 ALTER TABLE `judge_profile_badges` DISABLE KEYS */;
INSERT INTO `judge_profile_badges` VALUES
(1,1,1);
/*!40000 ALTER TABLE `judge_profile_badges` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_profile_organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_profile_organizations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `sort_value` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  `organization_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_profile_organizati_profile_id_organization__39a6d8b0_uniq` (`profile_id`,`organization_id`),
  KEY `judge_profile_organi_organization_id_da2a4d7d_fk_judge_org` (`organization_id`),
  CONSTRAINT `judge_profile_organi_organization_id_da2a4d7d_fk_judge_org` FOREIGN KEY (`organization_id`) REFERENCES `judge_organization` (`id`),
  CONSTRAINT `judge_profile_organi_profile_id_6b79e464_fk_judge_pro` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_profile_organizations` WRITE;
/*!40000 ALTER TABLE `judge_profile_organizations` DISABLE KEYS */;
INSERT INTO `judge_profile_organizations` VALUES
(1,1,1,2),
(2,2,1,1);
/*!40000 ALTER TABLE `judge_profile_organizations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_rating`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_rating` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rank` int(11) NOT NULL,
  `rating` int(11) NOT NULL,
  `last_rated` datetime(6) NOT NULL,
  `contest_id` int(11) NOT NULL,
  `participation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `mean` double NOT NULL,
  `performance` double NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `participation_id` (`participation_id`),
  UNIQUE KEY `judge_rating_user_id_contest_id_461d7897_uniq` (`user_id`,`contest_id`),
  KEY `judge_rating_contest_id_0e97ae8c_fk_judge_contest_id` (`contest_id`),
  KEY `judge_rating_last_rated_65ff05f9` (`last_rated`),
  CONSTRAINT `judge_rating_contest_id_0e97ae8c_fk_judge_contest_id` FOREIGN KEY (`contest_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_rating_participation_id_c8cf9d76_fk_judge_con` FOREIGN KEY (`participation_id`) REFERENCES `judge_contestparticipation` (`id`),
  CONSTRAINT `judge_rating_user_id_82072996_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_rating` WRITE;
/*!40000 ALTER TABLE `judge_rating` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_rating` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_runtimeversion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_runtimeversion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `version` varchar(64) NOT NULL,
  `priority` int(11) NOT NULL,
  `judge_id` int(11) NOT NULL,
  `language_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_runtimeversion_judge_id_96482e9d_fk_judge_judge_id` (`judge_id`),
  KEY `judge_runtimeversion_language_id_3ad8be59_fk_judge_language_id` (`language_id`),
  CONSTRAINT `judge_runtimeversion_judge_id_96482e9d_fk_judge_judge_id` FOREIGN KEY (`judge_id`) REFERENCES `judge_judge` (`id`),
  CONSTRAINT `judge_runtimeversion_language_id_3ad8be59_fk_judge_language_id` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_runtimeversion` WRITE;
/*!40000 ALTER TABLE `judge_runtimeversion` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_runtimeversion` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_solution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_solution` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `is_public` tinyint(1) NOT NULL,
  `publish_on` datetime(6) NOT NULL,
  `content` longtext NOT NULL,
  `problem_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `problem_id` (`problem_id`),
  CONSTRAINT `judge_solution_problem_id_44bbf556_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_solution` WRITE;
/*!40000 ALTER TABLE `judge_solution` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_solution` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_solution_authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_solution_authors` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `solution_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_solution_authors_solution_id_profile_id_e45470e0_uniq` (`solution_id`,`profile_id`),
  KEY `judge_solution_authors_profile_id_685bd965_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_solution_authors_profile_id_685bd965_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`),
  CONSTRAINT `judge_solution_authors_solution_id_eab0d5e6_fk_judge_solution_id` FOREIGN KEY (`solution_id`) REFERENCES `judge_solution` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_solution_authors` WRITE;
/*!40000 ALTER TABLE `judge_solution_authors` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_solution_authors` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_submission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_submission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` datetime(6) NOT NULL,
  `time` double DEFAULT NULL,
  `memory` double DEFAULT NULL,
  `points` double DEFAULT NULL,
  `status` varchar(2) NOT NULL,
  `result` varchar(3) DEFAULT NULL,
  `error` longtext DEFAULT NULL,
  `current_testcase` int(11) NOT NULL,
  `batch` tinyint(1) NOT NULL,
  `case_points` double NOT NULL,
  `case_total` double NOT NULL,
  `is_pretested` tinyint(1) NOT NULL,
  `judged_on_id` int(11) DEFAULT NULL,
  `language_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `contest_object_id` int(11) DEFAULT NULL,
  `judged_date` datetime(6) DEFAULT NULL,
  `locked_after` datetime(6) DEFAULT NULL,
  `rejudged_date` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_submission_judged_on_id_ef7707ef_fk_judge_judge_id` (`judged_on_id`),
  KEY `judge_submission_date_14094309` (`date`),
  KEY `judge_submission_status_3f629ced` (`status`),
  KEY `judge_submi_problem_8d5e0a_idx` (`problem_id`,`user_id`,`points` DESC,`time` DESC),
  KEY `judge_submi_result_7a005c_idx` (`result`,`id` DESC),
  KEY `judge_submi_result_ba9a62_idx` (`result`,`language_id`,`id` DESC),
  KEY `judge_submi_languag_dfe850_idx` (`language_id`,`id` DESC),
  KEY `judge_submi_result_a77e42_idx` (`result`,`problem_id`),
  KEY `judge_submi_languag_380ab4_idx` (`language_id`,`problem_id`,`result`),
  KEY `judge_submi_problem_49f8ec_idx` (`problem_id`,`result`),
  KEY `judge_submi_user_id_650db3_idx` (`user_id`,`problem_id`,`result`),
  KEY `judge_submi_user_id_ec9a4b_idx` (`user_id`,`result`),
  KEY `judge_submi_contest_59fbe3_idx` (`contest_object_id`,`problem_id`,`user_id`,`points` DESC,`time` DESC),
  CONSTRAINT `judge_submission_contest_object_id_c5586240_fk_judge_contest_id` FOREIGN KEY (`contest_object_id`) REFERENCES `judge_contest` (`id`),
  CONSTRAINT `judge_submission_judged_on_id_ef7707ef_fk_judge_judge_id` FOREIGN KEY (`judged_on_id`) REFERENCES `judge_judge` (`id`),
  CONSTRAINT `judge_submission_language_id_48a75504_fk_judge_language_id` FOREIGN KEY (`language_id`) REFERENCES `judge_language` (`id`),
  CONSTRAINT `judge_submission_problem_id_d2fabe38_fk_judge_problem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_problem` (`id`),
  CONSTRAINT `judge_submission_user_id_9764487f_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_submission` WRITE;
/*!40000 ALTER TABLE `judge_submission` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_submission` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_submissionsource`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_submissionsource` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source` longtext NOT NULL,
  `submission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `submission_id` (`submission_id`),
  CONSTRAINT `judge_submissionsour_submission_id_d4abc888_fk_judge_sub` FOREIGN KEY (`submission_id`) REFERENCES `judge_submission` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_submissionsource` WRITE;
/*!40000 ALTER TABLE `judge_submissionsource` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_submissionsource` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_submissiontestcase`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_submissiontestcase` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `case` int(11) NOT NULL,
  `status` varchar(3) NOT NULL,
  `time` double DEFAULT NULL,
  `memory` double DEFAULT NULL,
  `points` double DEFAULT NULL,
  `total` double DEFAULT NULL,
  `batch` int(11) DEFAULT NULL,
  `feedback` varchar(50) NOT NULL,
  `extended_feedback` longtext NOT NULL,
  `output` longtext NOT NULL,
  `submission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_submissiontestcase_submission_id_case_7aba3b7b_uniq` (`submission_id`,`case`),
  CONSTRAINT `judge_submissiontest_submission_id_a69f2d0e_fk_judge_sub` FOREIGN KEY (`submission_id`) REFERENCES `judge_submission` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_submissiontestcase` WRITE;
/*!40000 ALTER TABLE `judge_submissiontestcase` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_submissiontestcase` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_tag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_tag` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `group_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `judge_tag_group_id_b1433d7f_fk_judge_taggroup_id` (`group_id`),
  KEY `judge_tag_name_942c3a66` (`name`),
  CONSTRAINT `judge_tag_group_id_b1433d7f_fk_judge_taggroup_id` FOREIGN KEY (`group_id`) REFERENCES `judge_taggroup` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_tag` WRITE;
/*!40000 ALTER TABLE `judge_tag` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_tag` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_tagdata`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_tagdata` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `assigner_id` int(11) NOT NULL,
  `problem_id` int(11) NOT NULL,
  `tag_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_tagdata_tag_id_problem_id_8bea076a_uniq` (`tag_id`,`problem_id`),
  KEY `judge_tagdata_assigner_id_e3c18347_fk_judge_profile_id` (`assigner_id`),
  KEY `judge_tagdata_problem_id_58e0fe06_fk_judge_tagproblem_id` (`problem_id`),
  CONSTRAINT `judge_tagdata_assigner_id_e3c18347_fk_judge_profile_id` FOREIGN KEY (`assigner_id`) REFERENCES `judge_profile` (`id`),
  CONSTRAINT `judge_tagdata_problem_id_58e0fe06_fk_judge_tagproblem_id` FOREIGN KEY (`problem_id`) REFERENCES `judge_tagproblem` (`id`),
  CONSTRAINT `judge_tagdata_tag_id_ae307bf9_fk_judge_tag_id` FOREIGN KEY (`tag_id`) REFERENCES `judge_tag` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_tagdata` WRITE;
/*!40000 ALTER TABLE `judge_tagdata` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_tagdata` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_taggroup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_taggroup` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_taggroup` WRITE;
/*!40000 ALTER TABLE `judge_taggroup` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_taggroup` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_tagproblem`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_tagproblem` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `link` varchar(200) NOT NULL,
  `judge` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `judge_tagproblem_judge_f9d2c6b5` (`judge`),
  KEY `judge_tagproblem_name_a8e1541e` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_tagproblem` WRITE;
/*!40000 ALTER TABLE `judge_tagproblem` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_tagproblem` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_ticket`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_ticket` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(100) NOT NULL,
  `time` datetime(6) NOT NULL,
  `notes` longtext NOT NULL,
  `object_id` int(10) unsigned NOT NULL CHECK (`object_id` >= 0),
  `is_open` tinyint(1) NOT NULL,
  `content_type_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `is_contributive` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_ticket_content_type_id_376ebcf9_fk_django_content_type_id` (`content_type_id`),
  KEY `judge_ticket_user_id_5a5c0bce_fk_judge_profile_id` (`user_id`),
  CONSTRAINT `judge_ticket_content_type_id_376ebcf9_fk_django_content_type_id` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`),
  CONSTRAINT `judge_ticket_user_id_5a5c0bce_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_ticket` WRITE;
/*!40000 ALTER TABLE `judge_ticket` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_ticket` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_ticket_assignees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_ticket_assignees` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `ticket_id` int(11) NOT NULL,
  `profile_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judge_ticket_assignees_ticket_id_profile_id_6bdac784_uniq` (`ticket_id`,`profile_id`),
  KEY `judge_ticket_assignees_profile_id_84d298d8_fk_judge_profile_id` (`profile_id`),
  CONSTRAINT `judge_ticket_assignees_profile_id_84d298d8_fk_judge_profile_id` FOREIGN KEY (`profile_id`) REFERENCES `judge_profile` (`id`),
  CONSTRAINT `judge_ticket_assignees_ticket_id_0fd7b2f7_fk_judge_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `judge_ticket` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_ticket_assignees` WRITE;
/*!40000 ALTER TABLE `judge_ticket_assignees` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_ticket_assignees` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_ticketmessage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_ticketmessage` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `body` longtext NOT NULL,
  `time` datetime(6) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_ticketmessage_ticket_id_5e413158_fk_judge_ticket_id` (`ticket_id`),
  KEY `judge_ticketmessage_user_id_1dbfbfb0_fk_judge_profile_id` (`user_id`),
  CONSTRAINT `judge_ticketmessage_ticket_id_5e413158_fk_judge_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `judge_ticket` (`id`),
  CONSTRAINT `judge_ticketmessage_user_id_1dbfbfb0_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_ticketmessage` WRITE;
/*!40000 ALTER TABLE `judge_ticketmessage` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_ticketmessage` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_url`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_url` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `original_url` varchar(1000) NOT NULL,
  `short_code` varchar(20) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `short_code` (`short_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_url` WRITE;
/*!40000 ALTER TABLE `judge_url` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_url` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_useractivity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_useractivity` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `timestamp` datetime(6) NOT NULL,
  `path` varchar(500) NOT NULL,
  `method` varchar(10) NOT NULL,
  `ip_address` char(39) NOT NULL,
  `user_agent` longtext NOT NULL,
  `referer` longtext NOT NULL,
  `response_code` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `session_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `judge_useractivity_session_id_b4fd0bcd_fk_judge_usersession_id` (`session_id`),
  KEY `judge_usera_user_id_idx` (`user_id`,`timestamp` DESC),
  KEY `judge_usera_timesta_idx` (`timestamp`),
  KEY `judge_usera_ip_addr_idx` (`ip_address`,`timestamp` DESC),
  CONSTRAINT `judge_useractivity_session_id_b4fd0bcd_fk_judge_usersession_id` FOREIGN KEY (`session_id`) REFERENCES `judge_usersession` (`id`),
  CONSTRAINT `judge_useractivity_user_id_150fd882_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_useractivity` WRITE;
/*!40000 ALTER TABLE `judge_useractivity` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_useractivity` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_usersession`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_usersession` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `session_key` varchar(40) NOT NULL,
  `ip_address` char(39) NOT NULL,
  `user_agent` longtext NOT NULL,
  `device_type` varchar(20) NOT NULL,
  `browser` varchar(50) NOT NULL,
  `os` varchar(50) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `last_activity` datetime(6) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_key` (`session_key`),
  KEY `judge_users_last_ac_idx` (`last_activity`,`is_active`),
  KEY `judge_users_user_la_idx` (`user_id`,`last_activity` DESC),
  KEY `judge_users_device_idx` (`device_type`,`last_activity` DESC),
  KEY `judge_users_active_idx` (`is_active`,`device_type`,`last_activity` DESC),
  CONSTRAINT `judge_usersession_user_id_32b07fbc_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_usersession` WRITE;
/*!40000 ALTER TABLE `judge_usersession` DISABLE KEYS */;
/*!40000 ALTER TABLE `judge_usersession` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `judge_webauthncredential`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `judge_webauthncredential` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `cred_id` varchar(255) NOT NULL,
  `public_key` longtext NOT NULL,
  `counter` bigint(20) NOT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cred_id` (`cred_id`),
  KEY `judge_webauthncredential_user_id_8eaad7d2_fk_judge_profile_id` (`user_id`),
  CONSTRAINT `judge_webauthncredential_user_id_8eaad7d2_fk_judge_profile_id` FOREIGN KEY (`user_id`) REFERENCES `judge_profile` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `judge_webauthncredential` WRITE;
/*!40000 ALTER TABLE `judge_webauthncredential` DISABLE KEYS */;
INSERT INTO `judge_webauthncredential` VALUES
(1,'key','cred-1','pk',3,1);
/*!40000 ALTER TABLE `judge_webauthncredential` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `registration_registrationprofile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registration_registrationprofile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activation_key` varchar(64) NOT NULL,
  `user_id` int(11) NOT NULL,
  `activated` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `registration_registr_user_id_5fcbf725_fk_auth_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `registration_registrationprofile` WRITE;
/*!40000 ALTER TABLE `registration_registrationprofile` DISABLE KEYS */;
/*!40000 ALTER TABLE `registration_registrationprofile` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `registration_supervisedregistrationprofile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registration_supervisedregistrationprofile` (
  `registrationprofile_ptr_id` int(11) NOT NULL,
  PRIMARY KEY (`registrationprofile_ptr_id`),
  CONSTRAINT `registration_supervi_registrationprofile__0a59f3b2_fk_registrat` FOREIGN KEY (`registrationprofile_ptr_id`) REFERENCES `registration_registrationprofile` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `registration_supervisedregistrationprofile` WRITE;
/*!40000 ALTER TABLE `registration_supervisedregistrationprofile` DISABLE KEYS */;
/*!40000 ALTER TABLE `registration_supervisedregistrationprofile` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `reversion_revision`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reversion_revision` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date_created` datetime(6) NOT NULL,
  `comment` longtext NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `reversion_revision_user_id_17095f45_fk_auth_user_id` (`user_id`),
  KEY `reversion_revision_date_created_96f7c20c` (`date_created`),
  CONSTRAINT `reversion_revision_user_id_17095f45_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `reversion_revision` WRITE;
/*!40000 ALTER TABLE `reversion_revision` DISABLE KEYS */;
/*!40000 ALTER TABLE `reversion_revision` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `reversion_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reversion_version` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `object_id` varchar(191) NOT NULL,
  `format` varchar(255) NOT NULL,
  `serialized_data` longtext NOT NULL,
  `object_repr` longtext NOT NULL,
  `content_type_id` int(11) NOT NULL,
  `revision_id` int(11) NOT NULL,
  `db` varchar(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reversion_version_db_content_type_id_objec_b2c54f65_uniq` (`db`,`content_type_id`,`object_id`,`revision_id`),
  KEY `reversion_version_revision_id_af9f6a9d_fk_reversion_revision_id` (`revision_id`),
  KEY `reversion_v_content_f95daf_idx` (`content_type_id`,`db`),
  CONSTRAINT `reversion_version_content_type_id_7d0ff25c_fk_django_co` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`),
  CONSTRAINT `reversion_version_revision_id_af9f6a9d_fk_reversion_revision_id` FOREIGN KEY (`revision_id`) REFERENCES `reversion_revision` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `reversion_version` WRITE;
/*!40000 ALTER TABLE `reversion_version` DISABLE KEYS */;
/*!40000 ALTER TABLE `reversion_version` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `social_auth_association`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_auth_association` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `server_url` varchar(255) NOT NULL,
  `handle` varchar(255) NOT NULL,
  `secret` varchar(255) NOT NULL,
  `issued` int(11) NOT NULL,
  `lifetime` int(11) NOT NULL,
  `assoc_type` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `social_auth_association_server_url_handle_078befa2_uniq` (`server_url`,`handle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `social_auth_association` WRITE;
/*!40000 ALTER TABLE `social_auth_association` DISABLE KEYS */;
/*!40000 ALTER TABLE `social_auth_association` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `social_auth_code`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_auth_code` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `email` varchar(254) NOT NULL,
  `code` varchar(32) NOT NULL,
  `verified` tinyint(1) NOT NULL,
  `timestamp` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `social_auth_code_email_code_801b2d02_uniq` (`email`,`code`),
  KEY `social_auth_code_code_a2393167` (`code`),
  KEY `social_auth_code_timestamp_176b341f` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `social_auth_code` WRITE;
/*!40000 ALTER TABLE `social_auth_code` DISABLE KEYS */;
/*!40000 ALTER TABLE `social_auth_code` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `social_auth_nonce`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_auth_nonce` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `server_url` varchar(255) NOT NULL,
  `timestamp` int(11) NOT NULL,
  `salt` varchar(65) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `social_auth_nonce_server_url_timestamp_salt_f6284463_uniq` (`server_url`,`timestamp`,`salt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `social_auth_nonce` WRITE;
/*!40000 ALTER TABLE `social_auth_nonce` DISABLE KEYS */;
/*!40000 ALTER TABLE `social_auth_nonce` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `social_auth_partial`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_auth_partial` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `token` varchar(32) NOT NULL,
  `next_step` smallint(5) unsigned NOT NULL CHECK (`next_step` >= 0),
  `backend` varchar(32) NOT NULL,
  `timestamp` datetime(6) NOT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`data`)),
  PRIMARY KEY (`id`),
  KEY `social_auth_partial_token_3017fea3` (`token`),
  KEY `social_auth_partial_timestamp_50f2119f` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `social_auth_partial` WRITE;
/*!40000 ALTER TABLE `social_auth_partial` DISABLE KEYS */;
/*!40000 ALTER TABLE `social_auth_partial` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
DROP TABLE IF EXISTS `social_auth_usersocialauth`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_auth_usersocialauth` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `provider` varchar(32) NOT NULL,
  `uid` varchar(255) NOT NULL,
  `user_id` int(11) NOT NULL,
  `created` datetime(6) NOT NULL,
  `modified` datetime(6) NOT NULL,
  `extra_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`extra_data`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `social_auth_usersocialauth_provider_uid_e6b5e668_uniq` (`provider`,`uid`),
  KEY `social_auth_usersocialauth_user_id_17d28448_fk_auth_user_id` (`user_id`),
  KEY `social_auth_usersocialauth_uid_796e51dc` (`uid`),
  CONSTRAINT `social_auth_usersocialauth_user_id_17d28448_fk_auth_user_id` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`),
  CONSTRAINT `user_social_auth_uid_required` CHECK (`uid` <> '')
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `social_auth_usersocialauth` WRITE;
/*!40000 ALTER TABLE `social_auth_usersocialauth` DISABLE KEYS */;
INSERT INTO `social_auth_usersocialauth` VALUES
(1,'google-oauth2','g-123',2,'2026-10-02 03:12:12.000404','2026-10-02 03:12:12.000426','{\"email\": \"bob@example.com\"}');
/*!40000 ALTER TABLE `social_auth_usersocialauth` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;


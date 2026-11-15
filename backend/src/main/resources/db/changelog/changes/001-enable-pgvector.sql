
--liquibase formatted sql

--changeset teamai:001-enable-pgvector
CREATE EXTENSION IF NOT EXISTS vector;

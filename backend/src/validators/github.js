const Joi = require('joi');

const connectRepoSchema = Joi.object({
  projectId: Joi.string().uuid().required().messages({
    'string.guid': 'projectId must be a valid UUID',
    'any.required': 'projectId is required',
  }),
  url: Joi.string().uri().required().messages({
    'string.uri': 'url must be a valid URI',
    'any.required': 'url is required',
  }),
  branch: Joi.string().min(1).max(100).optional(),
});

const createBranchSchema = Joi.object({
  ticketId: Joi.string().uuid().required().messages({
    'string.guid': 'ticketId must be a valid UUID',
    'any.required': 'ticketId is required',
  }),
  branchName: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'branchName is required',
    'string.min': 'branchName must be at least 1 character',
    'string.max': 'branchName must not exceed 100 characters',
    'any.required': 'branchName is required',
  }),
});

const createPRSchema = Joi.object({
  ticketId: Joi.string().uuid().required().messages({
    'string.guid': 'ticketId must be a valid UUID',
    'any.required': 'ticketId is required',
  }),
  branchName: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'branchName is required',
    'string.min': 'branchName must be at least 1 character',
    'string.max': 'branchName must not exceed 100 characters',
    'any.required': 'branchName is required',
  }),
  title: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'title is required',
    'string.min': 'title must be at least 1 character',
    'string.max': 'title must not exceed 200 characters',
    'any.required': 'title is required',
  }),
  description: Joi.string().max(10000).allow('').optional(),
});

module.exports = { connectRepoSchema, createBranchSchema, createPRSchema };

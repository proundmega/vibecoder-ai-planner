const TemplateService = require('../services/TemplateService');
const Project = require('../models/project');
const { NotFoundError } = require('../errors/HttpError');

async function listTemplates(req, res, next) {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');
    const templates = await TemplateService.list(projectId, req.user.userId);
    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
}

async function createTemplate(req, res, next) {
  try {
    const { projectId } = req.params;
    const { name, description, file_definitions } = req.body;
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');
    if (!name || !name.trim()) {
      throw new Error('Template name is required');
    }
    if (!file_definitions || !Array.isArray(file_definitions) || file_definitions.length === 0) {
      throw new Error('At least one file definition is required');
    }
    const template = await TemplateService.create(projectId, name.trim(), description, file_definitions, req.user.userId);
    res.status(201).json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const { templateId } = req.params;
    const template = await TemplateService.delete(templateId, req.user.userId);
    if (!template) {
      throw new NotFoundError('Template not found or unauthorized');
    }
    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const { templateId } = req.params;
    const { name, description, file_definitions } = req.body;
    if (!name || !name.trim()) {
      throw new Error('Template name is required');
    }
    if (!file_definitions || !Array.isArray(file_definitions) || file_definitions.length === 0) {
      throw new Error('At least one file definition is required');
    }
    const template = await TemplateService.update(templateId, req.user.userId, name.trim(), description, file_definitions);
    if (!template) {
      throw new NotFoundError('Template not found or unauthorized');
    }
    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};

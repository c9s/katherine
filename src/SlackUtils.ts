const _ = require('underscore');
import {Deployment, SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";

export function createAttachmentsFromStdout(title : string, stdout : string) {
  return {
    'attachments': [{
      "pretext": title,
      "fallback": title,
      "text": "```\n" + stdout.trim() + "\n```",
      "color": "#aaa",
      "mrkdwn_in": ["text", "pretext"]
    }]
  };
}



export function buildDeploymentRevAttachment(deployment : Deployment) {
  const fields = [];
  if (deployment.revInfo) {
    if (deployment.revInfo.describe) {
      fields.push({ 
        'title': 'Describe',
        'value': deployment.revInfo.describe,
        'short': true
      })
    }

    if (deployment.revInfo.commits.length > 0) {
      const firstCommit = deployment.revInfo.commits[0];
      fields.push({ 
        'title': 'Commit',
        'value': firstCommit.hash
      })
      if (firstCommit.message) {
        fields.push({ 
          'title': 'Commit',
          'value': firstCommit.message,
        })
      }
      if (firstCommit.date) {
        fields.push({ 
          'title': 'Committed At',
          'value': firstCommit.date,
          'short': true
        })
      }
      if (firstCommit.author) {
        fields.push({ 
          'title': 'Author',
          'value': firstCommit.author.name,
          'short': true
        })
      }
    }
  }
  const attachment = {
    "title": `Application Revision`,
    "fallback": `Application Revision`,
    "color": "#cccccc",
    "fields": fields,
    "mrkdwn_in": ["text", "pretext", "fields"]
  };
  return attachment;
}

export function buildRequestAttachment(request) {
  let fields = [];
  if (request.sites) {
    fields.push({ 
      'title': 'Sites',
      'value': request.sites.join(', '),
      'short': true
    })
  }
  if (request.branch) {
    fields.push({ 
      'title': 'Branch',
      'value': request.branch,
      'short': true
    })
  }
  if (request.fromMessage && request.fromMessage.user) {
    fields.push({ 
      'title': 'By User',
      'value': `<@${request.fromMessage.user}>`,
      'short': true
    })
  }
  const attachment = {
    "title": `Operation Request`,
    "fallback": `Operation Request`,
    "color": "#cccccc",
    "fields": fields,
    "mrkdwn_in": ["text", "pretext", "fields"]
  };
  return attachment;
}

export function buildAttachmentsFromSummaryMap(request, deployment : Deployment = null, summaryMap : SummaryMap) {
  let attachments = [];
  if (deployment) {
    attachments.push(buildDeploymentRevAttachment(deployment));
  }
  if (request) {
    attachments.push(buildRequestAttachment(request));
  }
  _.each(summaryMap, (summaryMapResult : SummaryMapResult, host : string) => {
    let err = summaryMapResult.error;
    let message = null;

    if (err) {
      const failedItems = _.filter(summaryMapResult.history, (historyItem: SummaryMapHistory) => historyItem.error);
      _.each(failedItems, (failedItem : SummaryMapHistory) => {
        attachments.push({
          "pretext": `The operation on host ${host} has failed.`,
          "fallback": `The operation on host ${host} has failed.`,
          "text": "```\n" + failedItem.error.trim() + "\n```",
          "color": "red",
          "mrkdwn_in": ["text", "pretext"]
        });
      });
    } else {
      attachments.push({
        "text": `The operation on host ${host} has been successfully performed.`,
        "fallback": `The operation on host ${host} has been successfully performed.`,
        "color": "#36a64f",
        "mrkdwn_in": ["text", "pretext"]
      });
    }
  });
  return { 'attachments': attachments };
}

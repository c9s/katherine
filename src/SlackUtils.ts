const _ = require('underscore');
import {SummaryMap, SummaryMapResult, SummaryMapHistory, hasSummaryMapErrors} from "typeloy";

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

export function createAttachmentsFromSummaryMap(request, deployment, summaryMap : SummaryMap) {
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
        'value': firstCommit.hash,
        'short': true
      })
      if (firstCommit.committedAt) {
        fields.push({ 
          'title': 'Committed At',
          'value': firstCommit.committedAt,
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
      if (firstCommit.message) {
        fields.push({ 
          'title': 'Commit',
          'value': firstCommit.message,
        })
      }
    }
  }


  let attachments = [];
  _.each(summaryMap, (summaryMapResult : SummaryMapResult, host : string) => {
    let err = summaryMapResult.error;
    let message = null;

    if (err) {
      let failedItems = _.filter(summaryMapResult.history, (historyItem: SummaryMapHistory) => historyItem.error);
      _.each(failedItems, (failedItem : SummaryMapHistory) => {
        attachments.push({
          "pretext": `The deployment on host ${host} has failed.`,
          "fallback": `The deployment on host ${host} has failed.`,
          "text": "```\n" + failedItem.error.trim() + "\n```",
          "color": "red",
          "fields": fields,
          "mrkdwn_in": ["text", "pretext", "fields"]
        });
      });
    } else {
      attachments.push({
        "text": `The deployment on host ${host} has been successfully performed.`,
        "fallback": `The deployment on host ${host} has been successfully performed.`,
        "color": "#36a64f",
        "fields": fields,
        "mrkdwn_in": ["text", "pretext", "fields"]
      });
    }
  });
  return { 'attachments': attachments };
}

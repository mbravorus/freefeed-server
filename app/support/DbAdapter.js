import { default as uuid } from 'uuid'
import { each, isString } from 'lodash'

import { Attachment, Comment, Group, Post, Stats, Timeline, User } from '../models'


export const mkKey = (keys) => {
  const sep = ':'

  for (let key of keys) {
    if (!isString(key)) {
      throw new Error('keys should be strings')
    }
  }

  return keys.join(sep)
}

export class DbAdapter {
  constructor(database) {
    this.database = database
  }

  static initObject(classDef, attrs, id, params) {
    return new classDef({...attrs, ...{id}, ...params})
  }


  ///////////////////////////////////////////////////
  // User
  ///////////////////////////////////////////////////

  async setUserPassword(userId, updatedAt, hashedPassword) {
    let payload = {
      'updatedAt':      updatedAt.toString(),
      'hashedPassword': hashedPassword
    }
    return this._updateRecord(mkKey(['user', userId]), payload)
  }

  async createUser(payload) {
    let userId   = uuid.v4()
    let username = payload.username
    let email    = payload.email
    let userKey  = mkKey(['user', userId])
    let exists   = await this._existsRecord(userKey)

    if (exists !== 0) {
      throw new Error("Already exists")
    }

    let promises = [
      this._createUserUsernameIndex(userId, username),
      this._createRecord(userKey, payload)
    ]

    if (email && email.length > 0) {
      promises.push(this.createUserEmailIndex(userId, email))
    }
    await Promise.all(promises)
    return userId
  }

  updateUser(userId, payload) {
    return this._updateRecord(mkKey(['user', userId]), payload)
  }

  existsUser(userId) {
    return this._existsRecord(mkKey(['user', userId]))
  }

  async getFeedOwnerById(id) {
    const attrs = await this._getRecord(mkKey(['user', id]))

    if (!attrs) {
      return null
    }

    if (attrs.type === 'group') {
      return DbAdapter.initObject(Group, attrs, id)
    }

    return DbAdapter.initObject(User, attrs, id)
  }

  async getUserById(id) {
    const user = await this.getFeedOwnerById(id)

    if (!user) {
      return null
    }

    if (!(user instanceof User)) {
      throw new Error(`Expected User, got ${user.constructor.name}`)
    }

    return user
  }

  async getGroupById(id) {
    const user = await this.getFeedOwnerById(id)

    if (!user) {
      return null
    }

    if (!(user instanceof Group)) {
      throw new Error(`Expected Group, got ${user.constructor.name}`)
    }

    return user
  }

  async getUsersByIds(userIds) {
    const users = await this.getFeedOwnersByIds(userIds)

    each(users, user => {
      if (!(user instanceof User)) {
        throw new Error(`Expected User, got ${user.constructor.name}`)
      }
    })

    return users
  }


  async getFeedOwnersByIds(ids) {
    const responses = await this.findRecordsByIds('user', ids)

    const objects = responses.map((attrs, i) => {
      if (attrs.type === 'group') {
        return DbAdapter.initObject(Group, attrs, ids[i])
      }

      return DbAdapter.initObject(User, attrs, ids[i])
    })

    return objects
  }

  async getFeedOwnerByUsername(username) {
    const identifier = await this.getUserIdByUsername(username.toLowerCase())

    if (null === identifier) {
      return null
    }

    return this.getFeedOwnerById(identifier)
  }

  async getUserByUsername(username) {
    const feed = await this.getFeedOwnerByUsername(username)

    if (null === feed) {
      return null
    }

    if (!(feed instanceof User)) {
      throw new Error(`Expected User, got ${feed.constructor.name}`)
    }

    return feed
  }

  async getGroupByUsername(username) {
    const feed = await this.getFeedOwnerByUsername(username)

    if (null === feed) {
      return null
    }

    if (!(feed instanceof Group)) {
      throw new Error(`Expected Group, got ${feed.constructor.name}`)
    }

    return feed
  }

  async getUserByResetToken(token) {
    const uid = await this.findUserByAttributeIndex('reset', token)

    if (null === uid) {
      return null
    }

    return this.getUserById(uid)
  }

  async getUserByEmail(email) {
    const uid = await this.findUserByAttributeIndex('email', email.toLowerCase())

    if (null === uid) {
      return null
    }

    return this.getUserById(uid)
  }
  ///////////

  getUserTimelinesIds(userId) {
    return this._getRecord(mkKey(['user', userId, 'timelines']))
  }

  async getTimelineById(id, params) {
    const attrs = await this.findRecordById('timeline', id)

    if (!attrs) {
      return null
    }

    return DbAdapter.initObject(Timeline, attrs, id, params)
  }

  async getTimelinesByIds(ids, params) {
    const responses = await this.findRecordsByIds('timeline', ids)
    const objects = responses.map((attrs, i) => DbAdapter.initObject(Timeline, attrs, ids[i], params))

    return objects
  }

  getUserDiscussionsTimelineId(userId) {
    return userId
  }

  _createUserTimeline(userId, timelineName, timelineId) {
    let payload           = {}
    payload[timelineName] = timelineId
    return this._createRecord(mkKey(['user', userId, 'timelines']), payload)
  }


  ///////////////////////////////////////////////////
  // Post
  ///////////////////////////////////////////////////

  async createPost(payload) {
    let postId = uuid.v4()
    let key    = mkKey(['post', postId])
    let exists = await this._existsRecord(key)

    if (exists !== 0) {
      throw new Error("Already exists")
    }

    await this._createRecord(key, payload)
    return postId
  }

  updatePost(postId, payload) {
    return this._updateRecord(mkKey(['post', postId]), payload)
  }

  async getPostById(id, params) {
    const attrs = await this.findRecordById('post', id)

    if (!attrs) {
      return null
    }

    return DbAdapter.initObject(Post, attrs, id, params)
  }

  async getPostsByIds(ids, params) {
    const responses = await this.findRecordsByIds('post', ids)
    const objects = responses.map((attrs, i) => DbAdapter.initObject(Post, attrs, ids[i], params))

    return objects
  }

  setPostUpdatedAt(postId, time) {
    let payload = {
      'updatedAt': time
    }
    return this._updateRecord(mkKey(['post', postId]), payload)
  }

  deletePost(postId) {
    return this._deleteRecord(mkKey(['post', postId]))
  }

  ///////////

  createUserPostLike(postId, userId) {
    let now = new Date().getTime()
    return this._addElementToSortedSet(mkKey(['post', postId, 'likes']), now, userId)
  }

  getPostLikesCount(postId) {
    return this._getSortedSetElementsCount(mkKey(['post', postId, 'likes']))
  }

  getPostLikesRange(postId, fromIndex, toIndex) {
    return this._getSortedSetElements(mkKey(['post', postId, 'likes']), fromIndex, toIndex)
  }

  async hasUserLikedPost(userId, postId) {
    let score = await this._getSortedSetElementScore(mkKey(['post', postId, 'likes']), userId)
    return score && score >= 0
  }

  getUserPostLikedTime(userId, postId) {
    return this._getSortedSetElementScore(mkKey(['post', postId, 'likes']), userId)
  }

  removeUserPostLike(postId, userId) {
    return this._removeElementFromSortedSet(mkKey(['post', postId, 'likes']), userId)
  }

  deletePostLikes(postId) {
    return this._deleteRecord(mkKey(['post', postId, 'likes']))
  }

  ///////////

  createPostUsageInTimeline(postId, timelineId) {
    return this._addElementToSet(mkKey(['post', postId, 'timelines']), timelineId)
  }

  getPostUsagesInTimelinesCount(postId) {
    return this._getSetElementsCount(mkKey(['post', postId, 'timelines']))
  }

  getPostUsagesInTimelines(postId) {
    return this._getSetElements(mkKey(['post', postId, 'timelines']))
  }

  deletePostUsageInTimeline(postId, timelineId) {
    return this._removeElementFromSet(mkKey(['post', postId, 'timelines']), timelineId)
  }

  deletePostUsagesInTimelineIndex(postId) {
    return this._deleteRecord(mkKey(['post', postId, 'timelines']))
  }

  ///////////

  getPostPostedToIds(postId) {
    return this._getSetElements(mkKey(['post', postId, 'to']))
  }

  createPostPostedTo(postId, timelineIds) {
    return this._addElementToSet(mkKey(['post', postId, 'to']), timelineIds)
  }

  deletePostPostedTo(postId) {
    return this._deleteRecord(mkKey(['post', postId, 'to']))
  }

  ///////////

  getPostCommentsCount(postId) {
    return this._getListElementsCount(mkKey(['post', postId, 'comments']))
  }

  removeCommentFromPost(postId, commentId) {
    return this._removeOneElementFromList(mkKey(['post', postId, 'comments']), commentId)
  }

  getPostCommentsRange(postId, fromIndex, toIndex) {
    return this._getListElementsRange(mkKey(['post', postId, 'comments']), fromIndex, toIndex)
  }

  addCommentToPost(postId, commentId) {
    return this._addElementToList(mkKey(['post', postId, 'comments']), commentId)
  }

  deletePostComments(postId) {
    return this._deleteRecord(mkKey(['post', postId, 'comments']))
  }

  ///////////

  getPostAttachments(postId) {
    return this._getAllListElements(mkKey(['post', postId, 'attachments']))
  }

  addAttachmentToPost(postId, attachmentId) {
    return this._addElementToList(mkKey(['post', postId, 'attachments']), attachmentId)
  }

  removeAttachmentsFromPost(postId, attachmentId) {
    return this._removeAllElementsEqualToFromList(mkKey(['post', postId, 'attachments']), attachmentId)
  }


  ///////////////////////////////////////////////////
  // Reset password tokens
  ///////////////////////////////////////////////////

  createUserResetPasswordToken(userId, token) {
    return this._setIndexValue(mkKey(['reset', token, 'uid']), userId)
  }

  setUserResetPasswordTokenExpireAfter(token, expireAfter) {
    return this.database.expireAsync(mkKey(['reset', token, 'uid']), expireAfter)
  }

  deleteUserResetPasswordToken(token) {
    return this._deleteRecord(mkKey(['reset', token, 'uid']))
  }

  ///////////////////////////////////////////////////
  // Subscription requests
  ///////////////////////////////////////////////////

  getUserSubscriptionRequestsIds(currentUserId) {
    return this._getAllSortedSetElements(mkKey(['user', currentUserId, 'requests']))
  }

  async isSubscriptionRequestPresent(currentUserId, followedUserId) {
    let score = await this._getSortedSetElementScore(mkKey(['user', followedUserId, 'requests']), currentUserId)
    return score && score >= 0
  }

  createUserSubscriptionRequest(currentUserId, currentTime, followedUserId) {
    return this._addElementToSortedSet(mkKey(['user', followedUserId, 'requests']), currentTime, currentUserId)
  }

  deleteUserSubscriptionRequest(currentUserId, followerUserId) {
    return this._removeElementFromSortedSet(mkKey(['user', currentUserId, 'requests']), followerUserId)
  }

  ///////////////////////////////////////////////////
  // Pending (sent) requests
  ///////////////////////////////////////////////////

  getUserSubscriptionPendingRequestsIds(currentUserId) {
    return this._getAllSortedSetElements(mkKey(['user', currentUserId, 'pending']))
  }

  createUserSubscriptionPendingRequest(currentUserId, currentTime, followedUserId) {
    return this._addElementToSortedSet(mkKey(['user', currentUserId, 'pending']), currentTime, followedUserId)
  }

  deleteUserSubscriptionPendingRequest(currentUserId, followerUserId) {
    return this._removeElementFromSortedSet(mkKey(['user', followerUserId, 'pending']), currentUserId)
  }

  ///////////////////////////////////////////////////
  // Subscriptions
  ///////////////////////////////////////////////////

  getUserSubscriptionsIds(userId) {
    return this._getAllSortedSetElements(mkKey(['user', userId, 'subscriptions']))
  }

  createUserSubscription(currentUserId, currentTime, timelineId) {
    return this._addElementToSortedSet(mkKey(['user', currentUserId, 'subscriptions']), currentTime, timelineId)
  }

  deleteUserSubscription(currentUserId, timelineId) {
    return this._removeElementFromSortedSet(mkKey(['user', currentUserId, 'subscriptions']), timelineId)
  }

  ///////////////////////////////////////////////////
  // Bans
  ///////////////////////////////////////////////////

  getUserBansIds(userId) {
    return this._getAllSortedSetElements(mkKey(['user', userId, 'bans']))
  }

  createUserBan(currentUserId, bannedUserId) {
    let now = new Date().getTime()
    return this._addElementToSortedSet(mkKey(['user', currentUserId, 'bans']), now, bannedUserId)
  }

  deleteUserBan(currentUserId, bannedUserId) {
    return this._removeElementFromSortedSet(mkKey(['user', currentUserId, 'bans']), bannedUserId)
  }

  ///////////////////////////////////////////////////
  // User indexes
  ///////////////////////////////////////////////////

  existsUsername(username) {
    return this._existsRecord(mkKey(['username', username, 'uid']))
  }

  getUserIdByUsername(username) {
    return this._getIndexValue(mkKey(['username', username, 'uid']))
  }

  _createUserUsernameIndex(userId, username) {
    return this._setIndexValue(mkKey(['username', username, 'uid']), userId)
  }

  getUserIdByEmail(email) {
    return this._getIndexValue(mkKey(['email', this._normalizeUserEmail(email), 'uid']))
  }

  createUserEmailIndex(userId, email) {
    return this._setIndexValue(mkKey(['email', this._normalizeUserEmail(email), 'uid']), userId)
  }

  dropUserEmailIndex(email) {
    return this._deleteRecord(mkKey(['email', this._normalizeUserEmail(email), 'uid']))
  }

  ///////////////////////////////////////////////////
  // Group administrators
  ///////////////////////////////////////////////////

  getGroupAdministratorsIds(groupId) {
    return this._getAllSortedSetElements(mkKey(['user', groupId, 'administrators']))
  }

  addAdministratorToGroup(groupId, adminId) {
    let now = new Date().getTime()
    return this._addElementToSortedSet(mkKey(['user', groupId, 'administrators']), now, adminId)
  }

  removeAdministratorFromGroup(groupId, adminId) {
    return this._removeElementFromSortedSet(mkKey(['user', groupId, 'administrators']), adminId)
  }

  ///////////////////////////////////////////////////
  // Timelines
  ///////////////////////////////////////////////////

  createTimeline(payload) {
    let timelineId = uuid.v4()
    let userId     = payload.userId

    return this._createTimeline(timelineId, userId, payload)
  }

  createUserDiscussionsTimeline(userId, payload) {
    let timelineId = this.getUserDiscussionsTimelineId(userId)

    return this._createTimeline(timelineId, userId, payload)
  }

  async _createTimeline(timelineId, userId, payload) {
    let timelineKey = mkKey(['timeline', timelineId])
    let name        = payload.name
    let exists      = await this._existsRecord(timelineKey)

    if (exists !== 0) {
      throw new Error("Already exists")
    }

    let promises = [
      this._createUserTimeline(userId, name, timelineId),
      this._createRecord(timelineKey, payload)
    ]

    await Promise.all(promises)
    return timelineId
  }

  existsTimeline(timelineId) {
    return this._existsRecord(mkKey(['timeline', timelineId]))
  }

  addPostToTimeline(timelineId, time, postId) {
    return this._addElementToSortedSet(mkKey(['timeline', timelineId, 'posts']), time, postId)
  }

  async isPostPresentInTimeline(timelineId, postId) {
    let score = await this._getSortedSetElementScore(mkKey(['timeline', timelineId, 'posts']), postId)
    return score && score >= 0
  }

  getTimelinePostsCount(timelineId) {
    return this._getSortedSetElementsCount(mkKey(['timeline', timelineId, 'posts']))
  }

  getTimelinePostsRange(timelineId, startIndex, finishIndex) {
    return this._getSortedSetElements(mkKey(['timeline', timelineId, 'posts']), startIndex, finishIndex)
  }

  getTimelinePostsInTimeInterval(timelineId, timeIntervalStart, timeIntervalEnd) {
    return this.database.zrevrangebyscoreAsync(mkKey(['timeline', timelineId, 'posts']), timeIntervalStart, timeIntervalEnd)
  }

  removePostFromTimeline(timelineId, postId) {
    return this._removeElementFromSortedSet(mkKey(['timeline', timelineId, 'posts']), postId)
  }

  createMergedPostsTimeline(destinationTimelineId, sourceTimelineId1, sourceTimelineId2) {
    return this.database.zunionstoreAsync(
      mkKey(['timeline', destinationTimelineId, 'posts']), 2,
      mkKey(['timeline', sourceTimelineId1, 'posts']),
      mkKey(['timeline', sourceTimelineId2, 'posts']),
      'AGGREGATE', 'MAX'
    )
  }

  _getPostsTimelinesIntersection(destKey, sourceTimelineId1, sourceTimelineId2) {
    return this.database.zinterstoreAsync(
      destKey, 2,
      mkKey(['timeline', sourceTimelineId1, 'posts']),
      mkKey(['timeline', sourceTimelineId2, 'posts']),
      'AGGREGATE', 'MAX'
    )
  }

  getTimelineSubscribers(timelineId) {
    return this._getAllSortedSetElements(mkKey(['timeline', timelineId, 'subscribers']))
  }

  addTimelineSubscriber(timelineId, currentTime, currentUserId) {
    return this._addElementToSortedSet(mkKey(['timeline', timelineId, 'subscribers']), currentTime, currentUserId)
  }

  removeTimelineSubscriber(timelineId, currentUserId) {
    return this._removeElementFromSortedSet(mkKey(['timeline', timelineId, 'subscribers']), currentUserId)
  }

  async getTimelinesIntersectionPostIds(timelineId1, timelineId2) {
    // zinterstore saves results to a key. so we have to
    // create a temporary storage

    let randomKey = mkKey(['timeline', timelineId1, 'random', uuid.v4()])
    await this._getPostsTimelinesIntersection(randomKey, timelineId2, timelineId1)

    let postIds = await this._getTimelinesIntersectionPosts(randomKey)
    await this._deleteRecord(randomKey)

    return postIds
  }

  ///////////////////////////////////////////////////
  // Stats
  ///////////////////////////////////////////////////

  createUserStats(userId, payload) {
    return this._updateRecord(mkKey(['stats', userId]), payload)
  }

  async getStatsById(id, params) {
    const attrs = await this.findRecordById('stats', id)

    if (!attrs) {
      return null
    }

    return DbAdapter.initObject(Stats, attrs, id, params)
  }

  async getStatsByIds(ids, params) {
    const responses = await this.findRecordsByIds('stats', ids)
    const objects = responses.map((attrs, i) => DbAdapter.initObject(Stats, attrs, ids[i], params))

    return objects
  }

  changeUserStatsValue(userId, property, value) {
    return this.database.hincrbyAsync(mkKey(['stats', userId]), property, value)
  }

  addUserLikesStats(userId, likes) {
    return this._addElementToSortedSet(mkKey(['stats', 'likes']), likes, userId)
  }

  addUserPostsStats(userId, posts) {
    return this._addElementToSortedSet(mkKey(['stats', 'posts']), posts, userId)
  }

  addUserCommentsStats(userId, comments) {
    return this._addElementToSortedSet(mkKey(['stats', 'comments']), comments, userId)
  }

  addUserSubscribersStats(userId, subscribers) {
    return this._addElementToSortedSet(mkKey(['stats', 'subscribers']), subscribers, userId)
  }

  addUserSubscriptionsStats(userId, subscriptions) {
    return this._addElementToSortedSet(mkKey(['stats', 'subscriptions']), subscriptions, userId)
  }

  changeUserStats(userId, property, value) {
    return this.database.zincrbyAsync(mkKey(['stats', property]), value, userId)
  }


  ///////////////////////////////////////////////////
  // Comments
  ///////////////////////////////////////////////////

  async createComment(payload) {
    let commentId = uuid.v4()
    let key       = mkKey(['comment', commentId])
    let exists    = await this._existsRecord(key)

    if (exists !== 0) {
      throw new Error("Already exists")
    }

    await this._createRecord(key, payload)
    return commentId
  }

  async getCommentById(id, params) {
    const attrs = await this.findRecordById('comment', id)

    if (!attrs) {
      return null
    }

    return DbAdapter.initObject(Comment, attrs, id, params)
  }

  async getCommentsByIds(ids, params) {
    const responses = await this.findRecordsByIds('comment', ids)
    const objects = responses.map((attrs, i) => DbAdapter.initObject(Comment, attrs, ids[i], params))

    return objects
  }

  updateComment(commentId, payload) {
    return this._updateRecord(mkKey(['comment', commentId]), payload)
  }

  deleteComment(commentId) {
    return this._deleteRecord(mkKey(['comment', commentId]))
  }

  ///////////////////////////////////////////////////
  // Attachments
  ///////////////////////////////////////////////////

  async createAttachment(payload) {
    let attachmentId  = uuid.v4()
    let attachmentKey = mkKey(['attachment', attachmentId])
    let exists        = await this._existsRecord(attachmentKey)

    if (exists !== 0) {
      throw new Error("Already exists")
    }

    await this._createRecord(attachmentKey, payload)
    return attachmentId
  }

  async getAttachmentById(id, params) {
    const attrs = await this.findRecordById('attachment', id)

    if (!attrs) {
      return null
    }

    return DbAdapter.initObject(Attachment, attrs, id, params)
  }

  async getAttachmentsByIds(ids, params) {
    const responses = await this.findRecordsByIds('attachment', ids)
    const objects = responses.map((attrs, i) => DbAdapter.initObject(Attachment, attrs, ids[i], params))

    return objects
  }

  updateAttachment(attachmentId, payload) {
    return this._updateRecord(mkKey(['attachment', attachmentId]), payload)
  }

  setAttachmentPostId(attachmentId, postId) {
    let payload = {
      'postId': postId
    }
    return this._updateRecord(mkKey(['attachment', attachmentId]), payload)
  }

  ///////////////////////////////////////////////////
  // Timeline utils
  ///////////////////////////////////////////////////


  _getTimelinesIntersectionPosts(key) {
    return this.database.zrangeAsync(key, 0, -1)
  }

  ///////////////////////////////////////////////////
  // AbstractModel
  ///////////////////////////////////////////////////

  findRecordById(modelName, modelId) {
    return this._getRecord(mkKey([modelName, modelId]))
  }

  findRecordsByIds(modelName, modelIds) {
    let keys     = modelIds.map(id => mkKey([modelName, id]))
    let requests = keys.map(key => ['hgetall', key])

    return this.database.batch(requests).execAsync()
  }

  findUserByAttributeIndex(attribute, value) {
    return this._getIndexValue(mkKey([attribute, value, 'uid']))
  }

  ///////////////////////////////////////////////////
  // Base methods
  ///////////////////////////////////////////////////

  _existsRecord(key) {
    return this.database.existsAsync(key)
  }

  _getRecord(key) {
    return this.database.hgetallAsync(key)
  }

  _createRecord(key, payload) {
    return this.database.hmsetAsync(key, payload)
  }

  _updateRecord(key, payload) {
    return this.database.hmsetAsync(key, payload)
  }

  _deleteRecord(key) {
    return this.database.delAsync(key)
  }

  _getIndexValue(key) {
    return this.database.getAsync(key)
  }

  _setIndexValue(key, value) {
    return this.database.setAsync(key, value)
  }

  ///////////////////////////////////////////////////

  _getSortedSetElementsCount(key) {
    return this.database.zcardAsync(key)
  }

  _getSortedSetElementScore(key, element) {
    return this.database.zscoreAsync(key, element)
  }

  _getSortedSetElements(key, fromIndex, toIndex) {
    return this.database.zrevrangeAsync(key, fromIndex, toIndex)
  }

  _getAllSortedSetElements(key) {
    return this._getSortedSetElements(key, 0, -1)
  }

  _addElementToSortedSet(key, score, element) {
    return this.database.zaddAsync(key, score, element)
  }

  _removeElementFromSortedSet(key, element) {
    return this.database.zremAsync(key, element)
  }

  ///////////////////////////////////////////////////

  _getSetElementsCount(key) {
    return this.database.scardAsync(key)
  }

  _getSetElements(key) {
    return this.database.smembersAsync(key)
  }

  _addElementToSet(key, element) {
    return this.database.saddAsync(key, element)
  }

  _removeElementFromSet(key, element) {
    return this.database.sremAsync(key, element)
  }

  ///////////////////////////////////////////////////

  _getListElementsCount(key) {
    return this.database.llenAsync(key)
  }

  _getListElementsRange(key, fromIndex, toIndex) {
    return this.database.lrangeAsync(key, fromIndex, toIndex)
  }

  _getAllListElements(key) {
    return this._getListElementsRange(key, 0, -1)
  }

  _addElementToList(key, element) {
    return this.database.rpushAsync(key, element)
  }

  _removeOneElementFromList(key, element) {
    return this.database.lremAsync(key, 1, element)
  }

  _removeAllElementsEqualToFromList(key, element) {
    return this.database.lremAsync(key, 0, element)
  }

  ///////////////////////////////////////////////////

  _normalizeUserEmail(email) {
    return email.toLowerCase()
  }
}
